"""
Vettan AI Backend - Production Grade
Full conversation threading with context awareness
"""

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks, Depends, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Literal, Optional
from dataclasses import dataclass
from contextlib import asynccontextmanager
from datetime import datetime
import asyncio
import json
import math
import os
import threading
import time
import uuid
from dotenv import load_dotenv
import logging

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

from agent.research_pipeline import (
    research_complete,
    handle_followup,
    research_stream,
    handle_followup_stream
)
from database.supabase_client_v2 import (
    get_database_v2,
    get_user_scoped_db,
    DuplicateSessionError,
)
from database.supabase_admin_client import get_admin_client
from audio.tts import get_tts, VettanTTS
from utils.rate_limit import (
    POLICIES,
    RESEARCH_SLOTS_GLOBAL,
    RESEARCH_SLOTS_PER_USER,
    ConcurrencySlots,
    InMemoryTokenBucketStore,
)
from utils.rate_limit_http import RateLimitMiddleware, rate_limited, warn_if_multiprocess

# One process, one set of buckets. See utils/rate_limit.py for why a token
# bucket and not a sliding window, and for the two-layer split.
_rate_limit_store = InMemoryTokenBucketStore()

# Rate is not concurrency: the bucket above would happily let one user open
# twenty simultaneous streams in a second, and each of those ties up a
# threadpool slot plus several upstream connections.
_research_slots = ConcurrencySlots(
    per_key=RESEARCH_SLOTS_PER_USER,
    total=RESEARCH_SLOTS_GLOBAL,
)

_TOO_MANY_IN_FLIGHT = (
    "Too many research requests in progress. Wait for the current one to finish."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    warn_if_multiprocess(logger)
    # Connect to Supabase at startup (in a thread: the connect is blocking and can
    # retry with sleeps) so the first request doesn't pay for it.
    await asyncio.to_thread(get_database_v2)
    yield


app = FastAPI(
    title="Vettan AI API",
    version="5.0.0",
    description="Enterprise AI Research Agent",
    lifespan=lifespan
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

# ORDER IS LOAD-BEARING: this is registered BEFORE CORSMiddleware on purpose.
#
# Starlette's add_middleware does user_middleware.insert(0, ...) and
# build_middleware_stack wraps with reversed(), so the LAST-added middleware
# ends up OUTERMOST. Adding CORS after this one makes CORS wrap it, which is
# what lets a 429 from here still carry its Access-Control-Allow-Origin header.
#
# Swap these two calls and the browser reports an opaque CORS failure instead
# of a rate limit, with no 429 visible in the console at all. There is a test
# for exactly this in tests/test_rate_limit.py.
app.add_middleware(
    RateLimitMiddleware,
    store=_rate_limit_store,
    policy=POLICIES["ip"],
    exempt_paths=("/", "/health"),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# MODELS
# ============================================

class ResearchRequest(BaseModel):
    # Unbounded input becomes unbounded OpenAI/Tavily spend per call; this
    # rejects up front rather than truncating silently deep in the pipeline.
    query: str = Field(..., min_length=1, max_length=2000)
    max_iterations: int = 8
    use_cache: bool = True
    session_id: Optional[str] = None
    is_followup: bool = False

class Message(BaseModel):
    id: str
    role: str
    content: str
    citations: Optional[List[Dict]] = []
    metadata: Optional[Dict] = {}
    created_at: str

class ResearchResponse(BaseModel):
    output: str
    citations: List[Dict[str, Any]]
    metadata: Dict[str, Any]
    session_id: str
    messages: List[Message]

class AudioRequest(BaseModel):
    # TTS is billed per character, so an unbounded field is an unbounded bill.
    # 15000 is VettanTTS.RECOMMENDED_MAX, the point at which the audio layer
    # already truncates — this rejects up front exactly what would have been
    # silently discarded. A Field constraint yields FastAPI's standard 422 and
    # so avoids raising inside generate_audio, whose except block would launder
    # an HTTPException into a 500.
    text: str = Field(..., min_length=1, max_length=15000)
    voice: Literal["nova", "alloy", "echo", "fable", "onyx", "shimmer"] = "nova"

class UpdateSessionRequest(BaseModel):
    query: Optional[str] = None
    title: Optional[str] = None
    isFavorite: Optional[bool] = None
    is_favorite: Optional[bool] = None

# ============================================
# AUTHENTICATION
#
# Every research and history route depends on get_current_user. The returned
# AuthedUser carries BOTH the user id (for application-layer user_id filters)
# and the raw token (so the database handle can run as that user and let RLS
# enforce the same rule independently).
# ============================================

@dataclass(frozen=True)
class AuthedUser:
    id: str
    token: str


# One shared anon client for token verification. auth.get_user(token) takes the
# token per call, so this is stateless and safe to share — unlike the PostgREST
# client, which must be per-caller.
_auth_client = None
_auth_client_lock = threading.Lock()


def _get_auth_client():
    global _auth_client
    if _auth_client is not None:
        return _auth_client

    with _auth_client_lock:
        if _auth_client is not None:
            return _auth_client

        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            return None

        _auth_client = create_client(url, key)
        return _auth_client


def _verify_access_token(authorization: Optional[str]) -> AuthedUser:
    """
    Validate a 'Bearer <token>' Authorization header against Supabase auth
    and return the authenticated user, or raise HTTPException.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing access token")

    anon_client = _get_auth_client()
    if anon_client is None:
        raise HTTPException(status_code=503, detail="Auth is not configured on this server")

    try:
        response = anon_client.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        return AuthedUser(id=response.user.id, token=token)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")


async def get_current_user(authorization: Optional[str] = Header(None)) -> AuthedUser:
    """FastAPI dependency: the verified caller, or 401."""
    # get_user() is a blocking network call; keep it off the event loop.
    return await asyncio.to_thread(_verify_access_token, authorization)


# ============================================
# PER-USER RATE LIMITS
#
# Each of these is a drop-in replacement for get_current_user that also charges
# the request against a token bucket keyed by the authenticated user id. They
# return the same AuthedUser, so handler bodies are unchanged.
#
# The cost of a request varies by an order of magnitude — one /api/research
# call spends ~4 Tavily credits and two OpenAI calls, one /api/history call is
# a single cheap read — so they draw on separate buckets rather than one global
# request count.
#
# research and research/stream deliberately SHARE a bucket: the frontend falls
# back from the stream to the plain endpoint when the stream fails, so separate
# buckets would hand every user twice the intended budget and turn one 429 into
# a second paid request.
# ============================================

research_user = rate_limited("research", get_current_user, _rate_limit_store)
audio_user = rate_limited("audio", get_current_user, _rate_limit_store)
read_user = rate_limited("read", get_current_user, _rate_limit_store)
write_user = rate_limited("write", get_current_user, _rate_limit_store)
account_user = rate_limited("account", get_current_user, _rate_limit_store)


def _db_for(user: AuthedUser):
    """
    Database handle bound to this caller's JWT.

    Falls back to nothing rather than to the shared anon handle: serving a
    request with an unscoped client is exactly the failure being fixed.
    """
    return get_user_scoped_db(user.token)


# ============================================
# PERSISTENCE HELPERS
#
# The response is built from in-memory messages; the database writes happen
# after it is sent (BackgroundTasks), so users never wait on them. The same
# message dicts are returned and saved, so ids in the response match the rows.
# ============================================

# session_id -> event that is set once that session's background save finishes
_pending_saves: Dict[str, threading.Event] = {}


def _now_iso() -> str:
    return datetime.now().isoformat()


def _sse(event: str, data: Dict[str, Any]) -> str:
    """One server-sent-events frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _new_message(
    role: str,
    content: str,
    citations: Optional[List[Dict[str, Any]]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    created_at: Optional[str] = None
) -> Dict[str, Any]:
    return {
        'id': str(uuid.uuid4()),
        'role': role,
        'content': content,
        'citations': citations or [],
        'metadata': metadata or {},
        'created_at': created_at or _now_iso()
    }


def _to_message(msg: Dict[str, Any]) -> Message:
    return Message(
        id=msg['id'],
        role=msg['role'],
        content=msg['content'],
        citations=msg.get('citations', []),
        metadata=msg.get('metadata', {}),
        created_at=msg['created_at']
    )


def _register_pending_save(session_id: str) -> threading.Event:
    event = threading.Event()
    _pending_saves[session_id] = event
    return event


def _finish_pending_save(session_id: str, event: threading.Event) -> None:
    event.set()
    if _pending_saves.get(session_id) is event:
        del _pending_saves[session_id]


async def _wait_for_pending_save(session_id: str, timeout: float = 10.0) -> None:
    """If this session is still being saved, wait for it (a fast follow-up would otherwise find no rows)."""
    event = _pending_saves.get(session_id)
    if event and not event.is_set():
        logger.info(f"Waiting for pending save of session {session_id[:8]}")
        finished = await asyncio.to_thread(event.wait, timeout)
        if not finished:
            logger.warning(f"Pending save of session {session_id[:8]} did not finish within {timeout}s")


async def _wait_for_all_pending_saves(timeout: float = 10.0) -> None:
    """Let in-flight background saves land so a history read right after a query includes it."""
    for session_id in list(_pending_saves):
        await _wait_for_pending_save(session_id, timeout)


def _persist_new_session(
    db,
    event: threading.Event,
    session_id: str,
    query: str,
    report: str,
    citations: List[Dict[str, Any]],
    metadata: Dict[str, Any],
    messages: List[Dict[str, Any]],
    user_id: str
) -> None:
    """
    Background task: save a new session and its two messages (retries once).

    Runs after the response is sent. `db` must be the caller's token-scoped
    handle, captured at request time — the request scope is gone by now.
    """
    started = time.perf_counter()
    try:
        for attempt in (1, 2):
            try:
                saved = db.save_session(
                    query=query,
                    report=report,
                    citations=citations,
                    metadata=metadata,
                    user_id=user_id,
                    session_id=session_id,
                    messages=messages
                )
            except DuplicateSessionError:
                # Permanent: the same insert will be rejected identically, so a
                # retry only adds a second failure and a second's delay. The
                # client discovers this when the session is absent from history.
                logger.error(
                    f"Session {session_id[:8]} not saved: this account already has that query"
                )
                return
            if saved:
                logger.info(f"[DB] saved session {session_id[:8]} in background ({time.perf_counter() - started:.2f}s)")
                return
            if attempt == 1:
                logger.warning(f"Save of session {session_id[:8]} failed, retrying once")
                time.sleep(1.0)
        logger.error(f"Save of session {session_id[:8]} failed after retry; answer was returned but not persisted")
    except Exception as e:
        logger.error(f"Background save of session {session_id[:8]} crashed: {e}")
    finally:
        _finish_pending_save(session_id, event)


def _persist_followup(
    db,
    event: threading.Event,
    session_id: str,
    messages: List[Dict[str, Any]],
    user_id: str
) -> None:
    """Background task: save a follow-up's user and assistant messages (retries once)."""
    started = time.perf_counter()
    try:
        for attempt in (1, 2):
            if db.add_messages_batch(session_id, messages, user_id, touch_session=True):
                logger.info(f"[DB] saved follow-up in session {session_id[:8]} in background ({time.perf_counter() - started:.2f}s)")
                return
            if attempt == 1:
                logger.warning(f"Save of follow-up in session {session_id[:8]} failed, retrying once")
                time.sleep(1.0)
        logger.error(f"Save of follow-up in session {session_id[:8]} failed after retry; answer was returned but not persisted")
    except Exception as e:
        logger.error(f"Background save of follow-up in session {session_id[:8]} crashed: {e}")
    finally:
        _finish_pending_save(session_id, event)


# ============================================
# ENDPOINTS
# ============================================

@app.get("/")
async def root():
    return {"status": "Vettan AI Backend", "version": "5.0.0"}

@app.get("/health")
async def health_check():
    try:
        db = get_database_v2()
        db_status = db.is_connected if db else False
        schema_ready = bool(db and db.schema_ready)
        # Re-probe while degraded so /health reflects a migration applied since
        # startup without needing a restart.
        if db and db_status and not schema_ready:
            schema_ready = db.check_schema()
    except Exception:
        db_status = False
        schema_ready = False

    # A reachable database with the wrong schema is not healthy: saves fail and
    # history reads empty. Report that distinctly rather than as "healthy".
    #
    # account_deletion_configured is informational only and does not affect
    # `status`: it was missing on Render for a while with nothing surfacing it
    # anywhere except a 503 on the delete-account button itself.
    return {
        "status": "healthy" if (db_status and schema_ready) else "degraded",
        "database": db_status,
        "schema_ready": schema_ready,
        "account_deletion_configured": get_admin_client() is not None,
        **(
            {}
            if schema_ready
            else {"detail": "research_sessions.user_id missing - apply supabase/migrations/0001_add_user_id.sql"}
        ),
    }


def _require_schema(db) -> None:
    """
    Refuse to serve when the tenant-isolation schema is absent.

    Without this the app runs an expensive research job, returns it, and then
    silently fails to persist it — and history comes back empty with no error
    anywhere the user can see. A 503 naming the cause is far better than
    quietly losing the work.
    """
    if db is None or db.schema_ready:
        return

    # Re-probe before refusing. schema_ready is decided at startup, so without
    # this you would apply the migration and still get 503 until a restart,
    # which reads as "the fix didn't work". Only runs while degraded, so it
    # costs nothing in the normal case.
    if db.check_schema():
        logger.info("Schema became ready - migration applied; resuming normal service")
        return

    raise HTTPException(
        status_code=503,
        detail=(
            "Database schema is not ready: research_sessions.user_id is missing. "
            "Apply supabase/migrations/ in order: 0001_add_user_id.sql, "
            "0002_backfill_legacy_sessions.sql, 0003_enable_rls.sql, "
            "0004_scope_query_hash_unique.sql."
        ),
    )


@app.post("/api/research", response_model=ResearchResponse)
async def research(
    request: ResearchRequest,
    background_tasks: BackgroundTasks,
    user: AuthedUser = Depends(research_user)
):
    """
    Main research endpoint with full conversation threading. Follow-ups are
    answered via OpenAI chat directly (faster, and keeps conversation context)
    rather than re-running the full research pipeline.

    LATENCY: the response is built from in-memory messages and all database
    writes run after it is sent (see PERSISTENCE HELPERS), so the request only
    waits on the cache check (new queries) or one history read (follow-ups).

    AUTHORIZATION: every database call below goes through this caller's scoped
    handle and passes user.id. A session_id supplied by the client is never
    trusted on its own.
    """
    # Same in-flight cap as the streaming endpoint, and the same slots: this is
    # the fallback the frontend uses when a stream fails, so it is exactly as
    # expensive and must not be a way around the limit.
    if not _research_slots.try_acquire(user.id):
        raise HTTPException(status_code=429, detail=_TOO_MANY_IN_FLIGHT)

    try:
        db = _db_for(user)
        _require_schema(db)
        request_started = time.perf_counter()
        request_started_iso = _now_iso()

        logger.info("="*60)
        logger.info(f"REQUEST: {request.query[:80]}")
        logger.info(f"Session: {request.session_id[:8] if request.session_id else 'NEW'}")
        logger.info(f"Follow-up: {request.is_followup}")
        logger.info("="*60)
        
        # ============================================
        # FOLLOW-UP QUERY HANDLING
        # ============================================
        if request.session_id and request.is_followup:
            logger.info(f"Processing follow-up in session: {request.session_id[:8]}")
            
            if not db or not db.is_connected:
                raise HTTPException(status_code=503, detail="Database required for follow-ups")
            
            # If this session's first save is still in flight, let it finish
            await _wait_for_pending_save(request.session_id)

            # STEP 1: Get conversation history FOR CONTEXT (the only DB read on the path)
            logger.info(f"Loading conversation history...")
            db_started = time.perf_counter()
            conversation_history = await asyncio.to_thread(
                db.get_conversation_history, request.session_id, user.id
            )
            logger.info(f"[DB] get_conversation_history {time.perf_counter() - db_started:.2f}s")

            # Empty also means "exists but belongs to someone else" — the data
            # layer returns nothing for unowned sessions. Same 404 either way,
            # so this cannot be used to probe which session ids are real.
            if not conversation_history:
                logger.error(f"No history found for session: {request.session_id[:8]}")
                raise HTTPException(status_code=404, detail="Conversation not found")

            # STEP 2: The user's question, built in memory (saved after the response)
            user_msg = _new_message('user', request.query, created_at=request_started_iso)

            # The model sees the history including the new question, as before
            # (previously the question was saved and read back).
            context_history = conversation_history + [user_msg]

            logger.info(f"Context prepared with {len(context_history[-6:])} recent messages")

            result = await handle_followup(
                query=request.query,
                conversation_history=context_history
            )

            ai_content = result['output']
            citations = result.get('citations', [])
            metadata = result.get('metadata', {})

            # STEP 3: The AI response, built in memory
            assistant_msg = _new_message(
                'assistant',
                ai_content,
                citations=citations,
                metadata={
                    **metadata,
                    'is_followup': True
                }
            )

            # STEP 4: Save both messages after the response is sent
            pending = _register_pending_save(request.session_id)
            background_tasks.add_task(
                _persist_followup, db, pending, request.session_id, [user_msg, assistant_msg], user.id
            )

            # STEP 5: Full thread for the frontend (history + this exchange, no re-read)
            formatted_messages = [
                _to_message(msg) for msg in conversation_history + [user_msg, assistant_msg]
            ]

            logger.info(f"[Request] follow-up total {time.perf_counter() - request_started:.2f}s")
            logger.info("="*60)
            logger.info(f"FOLLOW-UP COMPLETE: Returning {len(formatted_messages)} messages")
            logger.info("="*60)
            
            return ResearchResponse(
                output=ai_content,
                citations=citations,
                metadata={
                    **metadata,
                    'is_followup': True,
                    'message_count': len(formatted_messages)
                },
                session_id=request.session_id,
                messages=formatted_messages
            )
        
        # ============================================
        # NEW CONVERSATION
        # ============================================
        logger.info(f"NEW conversation: {request.query[:100]}")

        cached_result = None
        if db and request.use_cache:
            try:
                db_started = time.perf_counter()
                cached_result = await asyncio.to_thread(db.check_cache, request.query, user.id)
                logger.info(f"[DB] check_cache {time.perf_counter() - db_started:.2f}s")
                if cached_result and cached_result.get('user_id') != user.id:
                    # check_cache already filters by user_id; this is a belt-and-braces
                    # guard because a hit hands its session id back to the caller, who
                    # may then write follow-ups into it.
                    logger.error("Cache returned a session owned by another user - discarding")
                    cached_result = None
                if cached_result:
                    report = cached_result.get('report', '')
                    if report and len(report) > 100 and 'stopped due to' not in report.lower():
                        logger.info("CACHE HIT - Valid result")
                        result = {
                            'output': report,
                            'citations': cached_result.get('citations', []),
                            'metadata': {
                                **cached_result.get('metadata', {}),
                                'from_cache': True,
                                'session_id': cached_result.get('id')
                            }
                        }
                    else:
                        cached_result = None
            except Exception as e:
                logger.warning(f"Cache check failed: {e}")
        
        # Cache miss — run new parallel pipeline
        is_new_session = not cached_result
        if is_new_session:
            result = await research_complete(request.query)
            session_id = str(uuid.uuid4())
        else:
            session_id = result.get('metadata', {}).get('session_id')

        output = result.get('output', '')

        # Build the initial thread in memory. Nulls are stripped from citations and
        # metadata, matching what save_session stores.
        user_msg = _new_message('user', request.query, created_at=request_started_iso)
        assistant_msg = _new_message(
            'assistant',
            output,
            citations=[
                {k: v for k, v in cite.items() if v is not None}
                for cite in result.get('citations', [])
            ],
            metadata={k: v for k, v in result.get('metadata', {}).items() if v is not None}
        )
        formatted_messages = [_to_message(user_msg), _to_message(assistant_msg)]

        # Save after the response is sent (creates the session and its two messages)
        if is_new_session:
            if db and db.is_connected and len(output) > 100:
                pending = _register_pending_save(session_id)
                background_tasks.add_task(
                    _persist_new_session,
                    db,
                    pending,
                    session_id,
                    request.query,
                    output,
                    result.get('citations', []),
                    dict(result.get('metadata', {})),
                    [user_msg, assistant_msg],
                    user.id
                )
            else:
                logger.warning("Result not saved (database unavailable or output too short)")
            result['metadata']['session_id'] = session_id

        logger.info(f"Session: {session_id[:8]}")
        logger.info(f"[Request] new query total {time.perf_counter() - request_started:.2f}s")
        logger.info("="*60)
        logger.info(f"NEW CONVERSATION COMPLETE: {len(formatted_messages)} messages")
        logger.info("="*60)
        
        return ResearchResponse(
            output=result['output'],
            citations=result.get('citations', []),
            metadata=result.get('metadata', {}),
            session_id=session_id,
            messages=formatted_messages
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to process research request")
    finally:
        # This handler builds its response before returning, so unlike the
        # streaming one the slot is safe to release here.
        _research_slots.release(user.id)

@app.post("/api/research/stream")
async def research_stream_endpoint(
    request: ResearchRequest,
    background_tasks: BackgroundTasks,
    user: AuthedUser = Depends(research_user)
):
    """
    Streaming counterpart of /api/research. Same request body, but the answer is
    sent as server-sent events so the UI can show progress instead of a spinner:

        stage   {phase, sub_queries}   sub-queries being searched
        sources {citations}            the sources the answer will cite
        token   {text}                 answer text, as it is generated
        done    {session_id, user_message_id, assistant_message_id, citations, metadata}
        error   {message}

    Persistence works exactly as on /api/research: ids are generated up front and
    the rows are written by a background task after the stream closes.

    AUTHORIZATION: as on /api/research, every database call uses this caller's
    token-scoped handle and passes user.id.
    """
    db = _db_for(user)
    _require_schema(db)
    request_started = time.perf_counter()
    request_started_iso = _now_iso()
    is_followup = bool(request.session_id and request.is_followup)

    logger.info("=" * 60)
    logger.info(f"STREAM REQUEST: {request.query[:80]}")
    logger.info(f"Session: {request.session_id[:8] if request.session_id else 'NEW'} | Follow-up: {is_followup}")
    logger.info("=" * 60)

    # Claimed here rather than in a dependency, and released inside the
    # generator rather than in a `yield` dependency's teardown. FastAPI closes
    # its AsyncExitStack before the response is handed back to Starlette, so a
    # yield-dependency's finally would fire before a single byte had streamed
    # and the slot would guard nothing.
    if not _research_slots.try_acquire(user.id):
        raise HTTPException(status_code=429, detail=_TOO_MANY_IN_FLIGHT)

    async def event_stream():
        saved = False
        try:
            # ============================================
            # FOLLOW-UP
            # ============================================
            if is_followup:
                if not db or not db.is_connected:
                    yield _sse("error", {"message": "Database required for follow-ups"})
                    return

                await _wait_for_pending_save(request.session_id)

                db_started = time.perf_counter()
                history = await asyncio.to_thread(
                    db.get_conversation_history, request.session_id, user.id
                )
                logger.info(f"[DB] get_conversation_history {time.perf_counter() - db_started:.2f}s")

                # Empty also covers "owned by someone else" — see /api/research.
                if not history:
                    logger.error(f"No history found for session: {request.session_id[:8]}")
                    yield _sse("error", {"message": "Conversation not found"})
                    return

                user_msg = _new_message('user', request.query, created_at=request_started_iso)

                final = None
                async for event in handle_followup_stream(
                    query=request.query,
                    conversation_history=history + [user_msg]
                ):
                    if event["type"] == "token":
                        yield _sse("token", {"text": event["text"]})
                    elif event["type"] == "final":
                        final = event

                if not final:
                    yield _sse("error", {"message": "No response generated"})
                    return

                metadata = {**final["metadata"], "is_followup": True}
                assistant_msg = _new_message(
                    'assistant', final["output"],
                    citations=final["citations"], metadata=metadata
                )

                pending = _register_pending_save(request.session_id)
                background_tasks.add_task(
                    _persist_followup, db, pending, request.session_id, [user_msg, assistant_msg], user.id
                )
                saved = True

                logger.info(f"[Request] streamed follow-up total {time.perf_counter() - request_started:.2f}s")
                yield _sse("done", {
                    "session_id": request.session_id,
                    "user_message_id": user_msg['id'],
                    "user_created_at": user_msg['created_at'],
                    "assistant_message_id": assistant_msg['id'],
                    "assistant_created_at": assistant_msg['created_at'],
                    "citations": final["citations"],
                    "metadata": metadata
                })
                return

            # ============================================
            # NEW CONVERSATION — cache first
            # ============================================
            cached = None
            if db and request.use_cache:
                try:
                    db_started = time.perf_counter()
                    cached = await asyncio.to_thread(db.check_cache, request.query, user.id)
                    logger.info(f"[DB] check_cache {time.perf_counter() - db_started:.2f}s")
                    if cached and cached.get('user_id') != user.id:
                        # See /api/research: a cache hit hands its session id to the
                        # caller, so double-check ownership before adopting it.
                        logger.error("Cache returned a session owned by another user - discarding")
                        cached = None
                    if cached:
                        report = cached.get('report', '')
                        if not (report and len(report) > 100 and 'stopped due to' not in report.lower()):
                            cached = None
                except Exception as e:
                    logger.warning(f"Cache check failed: {e}")
                    cached = None

            if cached:
                logger.info("CACHE HIT - streaming cached result")
                citations = cached.get('citations', [])
                metadata = {
                    **cached.get('metadata', {}),
                    'from_cache': True,
                    'session_id': cached.get('id')
                }
                yield _sse("sources", {"citations": citations, "sources_count": len(citations)})
                yield _sse("token", {"text": cached['report']})
                logger.info(f"[Request] cached stream total {time.perf_counter() - request_started:.2f}s")
                yield _sse("done", {
                    "session_id": cached.get('id'),
                    "user_message_id": str(uuid.uuid4()),
                    "user_created_at": request_started_iso,
                    "assistant_message_id": str(uuid.uuid4()),
                    "assistant_created_at": _now_iso(),
                    "citations": citations,
                    "metadata": metadata
                })
                return

            # ============================================
            # NEW CONVERSATION — run the pipeline
            # ============================================
            session_id = str(uuid.uuid4())
            final = None

            async for event in research_stream(request.query):
                kind = event["type"]
                if kind == "token":
                    yield _sse("token", {"text": event["text"]})
                elif kind == "stage":
                    yield _sse("stage", {"phase": event["phase"], "sub_queries": event["sub_queries"]})
                elif kind == "sources":
                    yield _sse("sources", {
                        "citations": event["citations"],
                        "sources_count": event["sources_count"]
                    })
                elif kind == "final":
                    final = event

            if not final:
                yield _sse("error", {"message": "No response generated"})
                return

            output = final["output"]
            metadata = {**final["metadata"], "session_id": session_id}

            user_msg = _new_message('user', request.query, created_at=request_started_iso)
            assistant_msg = _new_message(
                'assistant', output,
                citations=[
                    {k: v for k, v in cite.items() if v is not None}
                    for cite in final["citations"]
                ],
                metadata={k: v for k, v in metadata.items() if v is not None}
            )

            if db and db.is_connected and len(output) > 100:
                pending = _register_pending_save(session_id)
                background_tasks.add_task(
                    _persist_new_session,
                    db, pending, session_id, request.query, output,
                    final["citations"], dict(metadata),
                    [user_msg, assistant_msg], user.id
                )
                saved = True
            else:
                logger.warning("Streamed result not saved (database unavailable or output too short)")

            logger.info(f"[Request] streamed new query total {time.perf_counter() - request_started:.2f}s")
            yield _sse("done", {
                "session_id": session_id,
                "user_message_id": user_msg['id'],
                "user_created_at": user_msg['created_at'],
                "assistant_message_id": assistant_msg['id'],
                "assistant_created_at": assistant_msg['created_at'],
                "citations": final["citations"],
                "metadata": metadata
            })

        except asyncio.CancelledError:
            # Client went away mid-answer. Nothing is persisted: a truncated
            # answer should not become a saved session.
            logger.info(f"Stream aborted by client after {time.perf_counter() - request_started:.2f}s (nothing saved)")
            raise
        except Exception as e:
            logger.error(f"STREAM ERROR: {e}")
            import traceback
            traceback.print_exc()
            if not saved:
                yield _sse("error", {"message": "Failed to process research request"})
        finally:
            # Runs on normal completion, on error, and on the GeneratorExit
            # raised when the client disconnects mid-answer.
            _research_slots.release(user.id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"   # don't let a proxy buffer the stream
        }
    )


@app.get("/api/history/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    user: AuthedUser = Depends(read_user)
):
    """Get all messages in conversation thread (caller's own sessions only)"""
    try:
        logger.info(f"Fetching messages for session: {session_id[:8]}")

        db = _db_for(user)
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")

        messages = db.get_conversation_history(session_id, user.id)

        if not messages:
            logger.warning(f"No messages found for: {session_id[:8]}")
            return {"session_id": session_id, "messages": [], "count": 0}
        
        logger.info(f"Found {len(messages)} messages")
        
        formatted_messages = [
            {
                "id": msg['id'],
                "role": msg['role'],
                "content": msg['content'],
                "citations": msg.get('citations', []),
                "metadata": msg.get('metadata', {}),
                "created_at": msg['created_at']
            }
            for msg in messages
        ]
        
        return {
            "session_id": session_id,
            "messages": formatted_messages,
            "count": len(formatted_messages)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Message fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch messages")

@app.post("/api/audio")
async def generate_audio(
    request: AudioRequest,
    user: AuthedUser = Depends(audio_user)
):
    """
    Generate audio from text.

    Auth-gated like every other route: it spends OpenAI TTS credits per call and
    was the one endpoint left open, so anyone could bill this project's key.
    The caller's identity is not otherwise needed — no data is read or written.
    """
    try:
        if not request.text:
            raise HTTPException(status_code=400, detail="No text provided")
        
        logger.info(f"🎙️ Generating audio: {len(request.text)} chars, voice: {request.voice}")
        
        tts = get_tts()
        speech_text = tts.prepare_text_for_speech(request.text)

        # Long text is split into several OpenAI calls, so one request here can
        # cost many times what the flat charge in audio_user accounted for.
        # Drain the difference, but DON'T gate on the verdict: this call is
        # already in flight, and raising here would be caught by the except
        # below and laundered into a 500. The depletion is what blocks the
        # *next* request.
        extra_calls = math.ceil(len(speech_text) / VettanTTS.SAFE_CHUNK_SIZE) - 1
        if extra_calls > 0:
            await _rate_limit_store.consume(f"audio:{user.id}", POLICIES["audio"], cost=extra_calls)

        audio_bytes = tts.generate_audio(text=speech_text, voice=request.voice)
        
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Audio generation failed")
        
        import base64
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        cost = tts.estimate_cost(speech_text)
        
        logger.info(f"Audio generated: {len(audio_bytes)} bytes")
        
        return {
            "audio": audio_b64,
            "cost": cost,
            "length_chars": len(speech_text),
            "voice": request.voice,
            "format": "mp3"
        }
        
    except HTTPException:
        # Without this, the 400 and 500 raised above are caught by the clause
        # below and re-raised as a 500 with detail "400: No text provided" —
        # and any 429 would be laundered the same way. Every other handler in
        # this file has this guard; this one was missing it.
        raise
    except Exception as e:
        logger.error(f"Audio generation failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate audio")

@app.get("/api/history")
async def get_history(
    limit: int = Query(50, ge=1, le=100),
    user: AuthedUser = Depends(read_user)
):
    """
    Get the authenticated caller's conversation history.

    `limit` is bounded: it used to be an unbounded client-controlled integer, so
    ?limit=100000 dumped the table.
    """
    try:
        logger.info(f"📚 Fetching history: limit={limit}")
        await _wait_for_all_pending_saves()

        db = _db_for(user)
        # An empty list must mean "no history", never "the query failed".
        _require_schema(db)
        if db and db.is_connected:
            sessions = db.get_recent_sessions(user.id, limit=limit)
            
            formatted_sessions = [
                {
                    "id": s["id"],
                    "query": s["query"],
                    "created_at": s["created_at"],
                    "is_favorite": s.get("is_favorite", False)
                }
                for s in sessions
            ]
            
            logger.info(f"Retrieved {len(formatted_sessions)} sessions")
            return {"sessions": formatted_sessions}
        
        logger.warning("Database not connected")
        return {"sessions": []}

    except HTTPException:
        # Preserve deliberate status codes (e.g. the 503 from _require_schema);
        # without this they were being rewritten as an opaque 500.
        raise
    except Exception as e:
        logger.error(f"History fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch history")

@app.get("/api/history/{session_id}")
async def get_session(
    session_id: str,
    user: AuthedUser = Depends(read_user)
):
    """
    Get complete session with FULL message history

    Returns ALL messages in the thread — but only for a session this caller
    owns. Sessions belonging to someone else 404 exactly as missing ones do.
    """
    try:
        logger.info("="*60)
        logger.info(f"GET SESSION: {session_id[:8]}")
        logger.info("="*60)

        db = _db_for(user)
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")

        # Get session metadata (scoped: None when missing OR not owned)
        session_data = db.get_session_by_id(session_id, user.id)
        if not session_data:
            logger.error(f"Session not found or not owned: {session_id[:8]}")
            raise HTTPException(status_code=404, detail="Session not found")

        logger.info(f"Session found: {session_data.get('query', 'N/A')[:50]}")

        # Get FULL message history
        messages = db.get_conversation_history(session_id, user.id)
        
        if not messages:
            logger.warning(f"No messages found for session: {session_id[:8]}")
            messages = []
        else:
            # Message bodies are user content, not diagnostic data - log only
            # the count, not the text, so logs don't become a second copy of
            # every conversation.
            logger.info(f"Loaded {len(messages)} messages from database")
        
        formatted_messages = [
            {
                "id": msg['id'],
                "role": msg['role'],
                "content": msg['content'],
                "citations": msg.get('citations', []),
                "metadata": msg.get('metadata', {}),
                "created_at": msg['created_at']
            }
            for msg in messages
        ]
        
        logger.info("="*60)
        logger.info(f"RETURNING {len(formatted_messages)} messages to frontend")
        logger.info("="*60)
        
        return {
            "output": session_data.get("report", ""),
            "citations": session_data.get("citations", []),
            "metadata": session_data.get("metadata", {}),
            "session_id": session_id,
            "messages": formatted_messages
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Session fetch failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch session")

@app.patch("/api/history/{session_id}")
@app.put("/api/history/{session_id}")
async def update_session(
    session_id: str,
    request: UpdateSessionRequest,
    user: AuthedUser = Depends(write_user)
):
    """Update session (rename/favorite) — caller's own sessions only"""
    try:
        logger.info(f"✏️ Updating session: {session_id[:8]}")

        db = _db_for(user)
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")
        
        new_title = request.query or request.title
        is_favorite = request.is_favorite if request.is_favorite is not None else request.isFavorite
        
        if not new_title and is_favorite is None:
            raise HTTPException(status_code=400, detail="Must provide title or favorite status")
        
        update_data = {}
        if new_title:
            update_data['query'] = new_title
            logger.info(f"New title: {new_title[:50]}")
        if is_favorite is not None:
            update_data['is_favorite'] = is_favorite
            logger.info(f"Favorite: {is_favorite}")
        
        success = db.update_session(session_id, update_data, user.id)

        # False covers both "no such session" and "not yours".
        if not success:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"Session updated successfully")
        
        return {
            "success": True,
            "message": "Session updated",
            "session_id": session_id,
            "updates": update_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to update session")

@app.delete("/api/account")
async def delete_account(user: AuthedUser = Depends(account_user)):
    """
    Delete the authenticated user's Supabase auth account.

    research_sessions.user_id references auth.users(id) ON DELETE CASCADE, and
    messages.session_id cascades from research_sessions (0001_add_user_id.sql),
    so removing the auth user now also removes that user's research history.
    Sessions created before that migration have user_id NULL, belong to nobody,
    and are unaffected.
    """
    user_id = user.id

    admin_client = get_admin_client()
    if not admin_client:
        raise HTTPException(status_code=503, detail="Account deletion is not configured on this server")

    try:
        logger.info(f"Deleting auth user: {user_id[:8]}...")
        admin_client.auth.admin.delete_user(user_id)
        logger.info(f"Auth user deleted: {user_id[:8]}...")
        return {"success": True, "message": "Account deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Account deletion failed for user {user_id[:8]}...: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to delete account")


@app.delete("/api/history/{session_id}")
async def delete_session(
    session_id: str,
    user: AuthedUser = Depends(write_user)
):
    """Delete session and all messages — caller's own sessions only"""
    try:
        logger.info(f"🗑️ Deleting session: {session_id[:8]}")

        db = _db_for(user)
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")

        success = db.delete_session(session_id, user.id)

        # False covers both "no such session" and "not yours".
        if not success:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"Session deleted successfully")
        
        return {
            "success": True,
            "message": "Session deleted",
            "session_id": session_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete session")

if __name__ == "__main__":
    import uvicorn
    logger.info("="*60)
    logger.info("VETTAN AI BACKEND v5.0.0 STARTING")
    logger.info("="*60)
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")