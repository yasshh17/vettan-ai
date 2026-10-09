"""Vettan API: research, follow-ups, history and audio."""

from fastapi import FastAPI, HTTPException, Header, Depends, Query, Request
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
    RedisConcurrencySlots,
    RedisTokenBucketStore,
)
from utils.rate_limit_http import RateLimitMiddleware, rate_limited, request_ip, warn_if_multiprocess
from utils import audit, moderation, spend_guard

# Without Redis, limits are per process, so run a single worker.
_redis = None
if os.getenv("REDIS_URL", "").strip():
    import redis.asyncio as aioredis

    _redis_timeout = float(os.getenv("REDIS_TIMEOUT_SECONDS", "0.25"))
    _redis = aioredis.from_url(
        os.environ["REDIS_URL"].strip(),
        socket_timeout=_redis_timeout,
        socket_connect_timeout=_redis_timeout,
        health_check_interval=30,
        # Per worker. Keep workers x instances x this under the plan's connection limit.
        max_connections=int(os.getenv("REDIS_MAX_CONNECTIONS", "10")),
    )
    _rate_limit_store = RedisTokenBucketStore(_redis)
    # Caps concurrent research; the buckets limit rate, not how many run at once.
    _research_slots = RedisConcurrencySlots(
        _redis, per_key=RESEARCH_SLOTS_PER_USER, total=RESEARCH_SLOTS_GLOBAL
    )
else:
    _rate_limit_store = InMemoryTokenBucketStore()
    _research_slots = ConcurrencySlots(
        per_key=RESEARCH_SLOTS_PER_USER,
        total=RESEARCH_SLOTS_GLOBAL,
    )

# Daily spend caps. The token buckets limit rate, not total.
_spend_store = spend_guard.PostgresSpendStore(get_admin_client)

_TOO_MANY_IN_FLIGHT = (
    "Too many research requests in progress. Wait for the current one to finish."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    warn_if_multiprocess(logger, shared_store=_redis is not None)
    if _redis is not None:
        try:
            await _redis.ping()
            logger.info("Rate limits and research slots are shared through Redis")
        except Exception as e:
            logger.error(f"Redis is configured but unreachable ({e!r}); using per-process limits until it recovers")
    else:
        logger.info("REDIS_URL not set: rate limits are per process (single worker only)")
    logger.info(
        "Spend guard %s: user $%.2f/day, global $%.2f/day",
        "on" if spend_guard.ENABLED else "OFF",
        spend_guard.USER_DAILY_BUDGET_USD,
        spend_guard.GLOBAL_DAILY_BUDGET_USD,
    )
    if spend_guard.ENABLED and get_admin_client() is None:
        logger.error(
            "Spend guard is enabled but SUPABASE_SERVICE_ROLE_KEY is not configured. It fails "
            "closed, so research, follow-ups and audio will all return 503. Set the key, or "
            "SPEND_GUARD_ENABLED=false for local development only."
        )
    # Connect at startup so the first request doesn't pay for it.
    await asyncio.to_thread(get_database_v2)
    yield
    if _redis is not None:
        await _redis.aclose()


app = FastAPI(
    title="Vettan AI API",
    version="5.0.0",
    description="Enterprise AI Research Agent",
    lifespan=lifespan
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

# Must be added before CORSMiddleware: the last-added middleware is outermost, so
# CORS wraps this and its 429s keep their CORS headers. Covered in test_rate_limit.py.
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
    # Cross-origin JS can only read response headers listed here.
    expose_headers=[
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        spend_guard.MARKER_HEADER,
        moderation.MARKER_HEADER,
    ],
)

class ResearchRequest(BaseModel):
    # Bounded because input length drives OpenAI/Tavily cost.
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
    # Matches VettanTTS.RECOMMENDED_MAX; TTS is billed per character.
    text: str = Field(..., min_length=1, max_length=15000)
    voice: Literal["nova", "alloy", "echo", "fable", "onyx", "shimmer"] = "nova"

class UpdateSessionRequest(BaseModel):
    query: Optional[str] = None
    title: Optional[str] = None
    isFavorite: Optional[bool] = None
    is_favorite: Optional[bool] = None

# The token is kept so the database handle runs as this user and RLS applies too.
@dataclass(frozen=True)
class AuthedUser:
    id: str
    token: str


# Safe to share: auth.get_user() takes the token per call. PostgREST clients are per-caller.
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
    """Validate a Bearer token with Supabase auth, or raise 401/503."""
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


async def get_current_user(request: Request, authorization: Optional[str] = Header(None)) -> AuthedUser:
    # get_user() blocks on the network; keep it off the event loop.
    try:
        return await asyncio.to_thread(_verify_access_token, authorization)
    except HTTPException as e:
        if e.status_code == 401:
            audit.record("auth_failed", ip=request_ip(request), reason=e.detail, path=request.url.path)
        raise


# get_current_user plus a per-user bucket. research and research/stream share one
# because the frontend falls back from the stream to the plain endpoint.

research_user = rate_limited("research", get_current_user, _rate_limit_store)
audio_user = rate_limited("audio", get_current_user, _rate_limit_store)
read_user = rate_limited("read", get_current_user, _rate_limit_store)
write_user = rate_limited("write", get_current_user, _rate_limit_store)
account_user = rate_limited("account", get_current_user, _rate_limit_store)


def _db_for(user: AuthedUser):
    """Database handle bound to this caller's JWT. Never falls back to an unscoped client."""
    return get_user_scoped_db(user.token)


# Saves finish before we respond, so the next request sees them whichever worker
# serves it. Responses reuse the saved message dicts, so ids match the rows.


def _now_iso() -> str:
    return datetime.now().isoformat()


def _sse(event: str, data: Dict[str, Any]) -> str:
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


def _persist_new_session(
    db,
    session_id: str,
    query: str,
    report: str,
    citations: List[Dict[str, Any]],
    metadata: Dict[str, Any],
    messages: List[Dict[str, Any]],
    user_id: str
) -> None:
    """Save a new session and its messages, retrying once. `db` must be the caller's scoped handle."""
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
                # Permanent, so don't retry.
                logger.error(
                    f"Session {session_id[:8]} not saved: this account already has that query"
                )
                return
            if saved:
                logger.info(f"[DB] saved session {session_id[:8]} ({time.perf_counter() - started:.2f}s)")
                return
            if attempt == 1:
                logger.warning(f"Save of session {session_id[:8]} failed, retrying once")
                time.sleep(1.0)
        logger.error(f"Save of session {session_id[:8]} failed after retry; answer was returned but not persisted")
    except Exception as e:
        logger.error(f"Save of session {session_id[:8]} crashed: {e}")


def _persist_followup(
    db,
    session_id: str,
    messages: List[Dict[str, Any]],
    user_id: str
) -> None:
    """Save a follow-up's messages, retrying once."""
    started = time.perf_counter()
    try:
        for attempt in (1, 2):
            if db.add_messages_batch(session_id, messages, user_id, touch_session=True):
                logger.info(f"[DB] saved follow-up in session {session_id[:8]} ({time.perf_counter() - started:.2f}s)")
                return
            if attempt == 1:
                logger.warning(f"Save of follow-up in session {session_id[:8]} failed, retrying once")
                time.sleep(1.0)
        logger.error(f"Save of follow-up in session {session_id[:8]} failed after retry; answer was returned but not persisted")
    except Exception as e:
        logger.error(f"Save of follow-up in session {session_id[:8]} crashed: {e}")


@app.get("/")
async def root():
    return {"status": "Vettan AI Backend", "version": "5.0.0"}

@app.get("/health")
async def health_check():
    try:
        db = get_database_v2()
        db_status = db.is_connected if db else False
        schema_ready = bool(db and db.schema_ready)
        # Re-probe so a migration applied since startup shows up without a restart.
        if db and db_status and not schema_ready:
            schema_ready = db.check_schema()
    except Exception:
        db_status = False
        schema_ready = False

    # Wrong schema counts as degraded: saves fail and history reads empty.
    # account_deletion_configured is informational and doesn't affect status.
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
    """503 if the user_id schema is missing, rather than running paid work that can't be saved."""
    if db is None or db.schema_ready:
        return

    # Re-probe so an applied migration takes effect without a restart.
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


async def _cached_session(db, query: str, user_id: str) -> Optional[Dict[str, Any]]:
    """A usable cached session for this user, or None."""
    if not db:
        return None
    try:
        db_started = time.perf_counter()
        cached = await asyncio.to_thread(db.check_cache, query, user_id)
        logger.info(f"[DB] check_cache {time.perf_counter() - db_started:.2f}s")
    except Exception as e:
        logger.warning(f"Cache check failed: {e}")
        return None
    if not cached:
        return None
    if cached.get('user_id') != user_id:
        # check_cache filters by user already; a hit hands out its session id.
        logger.error("Cache returned a session owned by another user - discarding")
        return None
    report = cached.get('report', '')
    if not (report and len(report) > 100 and 'stopped due to' not in report.lower()):
        return None
    return cached


@app.post("/api/research", response_model=ResearchResponse)
async def research(
    request: ResearchRequest,
    user: AuthedUser = Depends(research_user)
):
    """
    Research or follow-up, non-streaming. Follow-ups use chat with history instead of
    re-running the pipeline. Every DB call is scoped to the caller.
    """
    # Same slots as the stream endpoint, since the frontend falls back to this one.
    if not await _research_slots.try_acquire(user.id):
        audit.record("inflight_rejected", user_id=user.id)
        raise HTTPException(status_code=429, detail=_TOO_MANY_IN_FLIGHT)

    try:
        db = _db_for(user)
        _require_schema(db)
        request_started = time.perf_counter()
        request_started_iso = _now_iso()

        # Before the cache and the charge: nothing paid runs on a flagged query.
        verdict = await moderation.check(request.query, "input", user.id)
        if verdict.flagged:
            raise moderation.blocked("input", verdict)

        logger.info("="*60)
        logger.info(f"REQUEST: {request.query[:80]}")
        logger.info(f"Session: {request.session_id[:8] if request.session_id else 'NEW'}")
        logger.info(f"Follow-up: {request.is_followup}")
        logger.info("="*60)
        
        if request.session_id and request.is_followup:
            logger.info(f"Processing follow-up in session: {request.session_id[:8]}")
            
            if not db or not db.is_connected:
                raise HTTPException(status_code=503, detail="Database required for follow-ups")

            logger.info(f"Loading conversation history...")
            db_started = time.perf_counter()
            conversation_history = await asyncio.to_thread(
                db.get_conversation_history, request.session_id, user.id
            )
            logger.info(f"[DB] get_conversation_history {time.perf_counter() - db_started:.2f}s")

            # Empty also means "not yours"; same 404 so ids can't be probed.
            if not conversation_history:
                logger.error(f"No history found for session: {request.session_id[:8]}")
                raise HTTPException(status_code=404, detail="Conversation not found")

            user_msg = _new_message('user', request.query, created_at=request_started_iso)

            context_history = conversation_history + [user_msg]

            logger.info(f"Context prepared with {len(context_history[-6:])} recent messages")

            await spend_guard.charge(
                _spend_store, user.id, "followup", spend_guard.cost_usd("followup")
            )

            result = await handle_followup(
                query=request.query,
                conversation_history=context_history
            )

            ai_content = result['output']
            citations = result.get('citations', [])

            verdict = await moderation.check(ai_content, "output", user.id)
            if verdict.flagged:
                raise moderation.blocked("output", verdict)

            metadata = result.get('metadata', {})

            assistant_msg = _new_message(
                'assistant',
                ai_content,
                citations=citations,
                metadata={
                    **metadata,
                    'is_followup': True
                }
            )

            await asyncio.to_thread(
                _persist_followup, db, request.session_id, [user_msg, assistant_msg], user.id
            )

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
        
        logger.info(f"NEW conversation: {request.query[:100]}")

        cached_result = await _cached_session(db, request.query, user.id) if request.use_cache else None
        if cached_result:
            logger.info("CACHE HIT - Valid result")
            result = {
                'output': cached_result['report'],
                'citations': cached_result.get('citations', []),
                'metadata': {
                    **cached_result.get('metadata', {}),
                    'from_cache': True,
                    'session_id': cached_result.get('id')
                }
            }

        is_new_session = not cached_result
        if is_new_session:
            await spend_guard.charge(
                _spend_store, user.id, "research", spend_guard.cost_usd("research")
            )
            result = await research_complete(request.query)
            verdict = await moderation.check(result.get('output', ''), "output", user.id)
            if verdict.flagged:
                raise moderation.blocked("output", verdict)
            session_id = str(uuid.uuid4())
        else:
            session_id = result.get('metadata', {}).get('session_id')

        output = result.get('output', '')

        # Nulls stripped to match what save_session stores.
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

        if is_new_session:
            if db and db.is_connected and len(output) > 100:
                await asyncio.to_thread(
                    _persist_new_session,
                    db,
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
        _research_slots.release(user.id)

@app.post("/api/research/stream")
async def research_stream_endpoint(
    request: ResearchRequest,
    user: AuthedUser = Depends(research_user)
):
    """
    Streaming /api/research. SSE events:

        stage   {phase, sub_queries}
        sources {citations}
        token   {text}
        done    {session_id, user_message_id, assistant_message_id, citations, metadata}
        error   {message}
        blocked {message}   answer withheld by moderation; drop what was streamed
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

    # Moderation goes first: a flagged query gets no slot, no charge and no search.
    # Before the charge: a cached answer is free, even for a user at their limit.
    moderated = moderation.check(request.query, "input", user.id)
    if not is_followup and request.use_cache:
        verdict, cached = await asyncio.gather(
            moderated, _cached_session(db, request.query, user.id)
        )
    else:
        verdict, cached = await moderated, None
    if verdict.flagged:
        raise moderation.blocked("input", verdict)

    # Not a yield dependency: its teardown runs before the stream starts.
    if not await _research_slots.try_acquire(user.id):
        audit.record("inflight_rejected", user_id=user.id)
        raise HTTPException(status_code=429, detail=_TOO_MANY_IN_FLIGHT)

    # Charge before streaming so a rejection is a real 429/503, not an SSE error.
    # Refunded on early exit.
    reservation = None
    if not cached:
        spend_kind = "followup" if is_followup else "research"
        try:
            reservation = await spend_guard.charge(
                _spend_store, user.id, spend_kind, spend_guard.cost_usd(spend_kind)
            )
        except BaseException:
            # The generator's finally won't run, so release the slot here.
            _research_slots.release(user.id)
            raise

    async def event_stream():
        saved = False
        try:
            if is_followup:
                if not db or not db.is_connected:
                    await spend_guard.refund(_spend_store, reservation)
                    yield _sse("error", {"message": "Database required for follow-ups"})
                    return

                db_started = time.perf_counter()
                history = await asyncio.to_thread(
                    db.get_conversation_history, request.session_id, user.id
                )
                logger.info(f"[DB] get_conversation_history {time.perf_counter() - db_started:.2f}s")

                # Empty also covers "owned by someone else" — see /api/research.
                if not history:
                    logger.error(f"No history found for session: {request.session_id[:8]}")
                    await spend_guard.refund(_spend_store, reservation)
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

                verdict = await moderation.check(final["output"], "output", user.id)
                if verdict.flagged:
                    # Not "error": the frontend retries errors on /api/research, paying again.
                    yield _sse("blocked", {"message": moderation.message("output", verdict)})
                    return

                metadata = {**final["metadata"], "is_followup": True}
                assistant_msg = _new_message(
                    'assistant', final["output"],
                    citations=final["citations"], metadata=metadata
                )

                await asyncio.to_thread(
                    _persist_followup, db, request.session_id, [user_msg, assistant_msg], user.id
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

            verdict = await moderation.check(final["output"], "output", user.id)
            if verdict.flagged:
                yield _sse("blocked", {"message": moderation.message("output", verdict)})
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
                await asyncio.to_thread(
                    _persist_new_session,
                    db, session_id, request.query, output,
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
            # Client disconnected; don't save a truncated answer.
            logger.info(f"Stream aborted by client after {time.perf_counter() - request_started:.2f}s (nothing saved)")
            raise
        except Exception as e:
            logger.error(f"STREAM ERROR: {e}")
            import traceback
            traceback.print_exc()
            if not saved:
                yield _sse("error", {"message": "Failed to process research request"})
        finally:
            # Also runs on GeneratorExit when the client disconnects.
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
    """Messages in a session owned by the caller."""
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
    """Text to speech. Authenticated because it spends OpenAI credits."""
    try:
        if not request.text:
            raise HTTPException(status_code=400, detail="No text provided")
        
        logger.info(f"🎙️ Generating audio: {len(request.text)} chars, voice: {request.voice}")
        
        tts = get_tts()
        speech_text = tts.prepare_text_for_speech(request.text)

        # The client sends this text, so it isn't necessarily an answer we generated.
        verdict = await moderation.check(speech_text, "audio", user.id)
        if verdict.flagged:
            raise moderation.blocked("audio", verdict)

        # Long text costs several calls. Charge the extra to the bucket without gating,
        # so the next request is the one that gets limited.
        extra_calls = math.ceil(len(speech_text) / VettanTTS.SAFE_CHUNK_SIZE) - 1
        if extra_calls > 0:
            await _rate_limit_store.consume(f"audio:{user.id}", POLICIES["audio"], cost=extra_calls)

        # Per character: estimate_cost() caps at RECOMMENDED_MAX, chunked TTS doesn't.
        await spend_guard.charge(
            _spend_store,
            user.id,
            "audio",
            spend_guard.audio_cost_usd(len(speech_text)),
            units=len(speech_text),
        )

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
        raise
    except Exception as e:
        logger.error(f"Audio generation failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate audio")

@app.get("/api/history")
async def get_history(
    limit: int = Query(50, ge=1, le=100),
    user: AuthedUser = Depends(read_user)
):
    """The caller's recent sessions."""
    try:
        logger.info(f"📚 Fetching history: limit={limit}")

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
        raise
    except Exception as e:
        logger.error(f"History fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch history")

@app.get("/api/history/{session_id}")
async def get_session(
    session_id: str,
    user: AuthedUser = Depends(read_user)
):
    """A session and all its messages. Someone else's session is a 404, same as a missing one."""
    try:
        logger.info("="*60)
        logger.info(f"GET SESSION: {session_id[:8]}")
        logger.info("="*60)

        db = _db_for(user)
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")

        session_data = db.get_session_by_id(session_id, user.id)
        if not session_data:
            logger.error(f"Session not found or not owned: {session_id[:8]}")
            raise HTTPException(status_code=404, detail="Session not found")

        logger.info(f"Session found: {session_data.get('query', 'N/A')[:50]}")

        messages = db.get_conversation_history(session_id, user.id)
        
        if not messages:
            logger.warning(f"No messages found for session: {session_id[:8]}")
            messages = []
        else:
            # Log the count only; message bodies are user content.
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
    """Rename or favorite one of the caller's sessions."""
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
    """Delete the caller's auth account. Their sessions and messages cascade (migration 0001)."""
    user_id = user.id

    admin_client = get_admin_client()
    if not admin_client:
        raise HTTPException(status_code=503, detail="Account deletion is not configured on this server")

    try:
        logger.info(f"Deleting auth user: {user_id[:8]}...")
        admin_client.auth.admin.delete_user(user_id)
        logger.info(f"Auth user deleted: {user_id[:8]}...")
        audit.record("account_deleted", user_id=user_id)
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
    """Delete one of the caller's sessions and its messages."""
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