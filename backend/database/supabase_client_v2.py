"""Supabase data layer: sessions, messages and the per-user cache."""

from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
import os
import hashlib
import threading
from collections import OrderedDict
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime, timedelta
import time
import json
import uuid
from dotenv import load_dotenv

import logging

logger = logging.getLogger(__name__)

load_dotenv()


# Set by the shared instance's startup probe; scoped instances reuse it.
_schema_ready_shared: bool = False


class DuplicateSessionError(Exception):
    """The user already has a session with this query_hash. Permanent, so callers skip the retry."""


def _is_duplicate_key(err: Exception) -> bool:
    """True for PostgREST/Postgres unique-violation (SQLSTATE 23505)."""
    text = str(err)
    return "23505" in text or "duplicate key value" in text


def _build_client(url: str, key: str, access_token: Optional[str] = None) -> Client:
    """With access_token, requests run as that user under RLS; without it, as anon (sees nothing)."""
    if access_token:
        return create_client(
            url,
            key,
            options=ClientOptions(
                headers={"Authorization": f"Bearer {access_token}"}
            ),
        )
    return create_client(url, key)


class VettanDatabaseV2:
    """Database client. Token-scoped instances must only be used for their own caller."""
    
    def __init__(
        self,
        max_retries: int = 3,
        timeout: int = 10,
        access_token: Optional[str] = None,
        verify_connection: bool = True,
    ):
        """
        access_token: run every request as this user (RLS applies).
        verify_connection: skipped for scoped instances; the shared one already checked.
        """
        self.max_retries = max_retries
        self.timeout = timeout
        self.access_token = access_token
        self.client: Optional[Client] = None
        self.is_connected = False
        self.schema_ready = False

        if verify_connection:
            self._connect()
        else:
            self._connect_unverified()

    def _connect_unverified(self) -> bool:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")

        if not url or not key:
            self.is_connected = False
            return False

        try:
            self.client = _build_client(url, key, self.access_token)
            self.is_connected = True
            self.schema_ready = _schema_ready_shared
            return True
        except Exception as e:
            print(f"❌ Failed to build scoped client: {str(e)[:100]}")
            self.is_connected = False
            return False

    def check_schema(self) -> bool:
        """
        Check research_sessions.user_id exists. Without it every query fails with 42703
        and the handlers return [], which looks like an empty account.
        """
        global _schema_ready_shared

        if not self.client:
            self.schema_ready = False
            _schema_ready_shared = False
            return False

        try:
            self.client.table('research_sessions').select('user_id').limit(1).execute()
            self.schema_ready = True
            _schema_ready_shared = True
            print("✅ Schema check passed: research_sessions.user_id present")
            return True

        except Exception as e:
            self.schema_ready = False
            _schema_ready_shared = False
            detail = str(e)
            logger.error(
                "\n"
                "==================================================================\n"
                "  DATABASE SCHEMA IS NOT READY - tenant isolation cannot work\n"
                "==================================================================\n"
                "  research_sessions.user_id is missing or unreadable.\n"
                "\n"
                "  Every save will fail and history will come back empty.\n"
                "\n"
                "  Apply the pending migrations, in order:\n"
                "    supabase/migrations/0001_add_user_id.sql\n"
                "    supabase/migrations/0002_backfill_legacy_sessions.sql\n"
                "    supabase/migrations/0003_enable_rls.sql\n"
                "    supabase/migrations/0004_scope_query_hash_unique.sql\n"
                "\n"
                "  PostgREST said: %s\n"
                "==================================================================",
                detail,
            )
            return False

    def _connect(self) -> bool:
        """Connect with exponential backoff. Returns whether it succeeded."""
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        
        if not url or not key:
            print("⚠️ SUPABASE_URL or SUPABASE_KEY not found - running without database")
            self.is_connected = False
            return False
        
        if not url.startswith(('http://', 'https://')):
            print(f"❌ Invalid SUPABASE_URL format: {url}")
            self.is_connected = False
            return False
        
        for attempt in range(1, self.max_retries + 1):
            try:
                print(f"🔄 Connecting to Supabase (attempt {attempt}/{self.max_retries})...")

                self.client = _build_client(url, key, self.access_token)

                self.client.table('research_sessions').select('id').limit(1).execute()

                print(f"✅ Connected to Supabase: {url}")
                self.is_connected = True

                # The probe above only reads `id`, so it passes without user_id.
                self.check_schema()
                return True
                
            except Exception as e:
                wait_time = 2 ** attempt  # Exponential backoff: 2, 4, 8 seconds
                print(f"❌ Connection attempt {attempt} failed: {str(e)[:100]}")
                
                if attempt < self.max_retries:
                    print(f"⏳ Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    print(f"❌ Failed to connect after {self.max_retries} attempts")
                    print(f"⚠️ Running in degraded mode (no caching/history)")
                    self.is_connected = False
                    return False
    
    @staticmethod
    def generate_query_hash(query: str) -> str:
        normalized = query.lower().strip()
        return hashlib.md5(normalized.encode()).hexdigest()

    def owns_session(self, session_id: str, user_id: str) -> bool:
        """Ownership comes from the parent session, like the RLS policy. NULL user_id is owned by nobody."""
        if not self.is_connected or not self.client:
            return False

        if not session_id or not user_id:
            return False

        try:
            response = self.client.table('research_sessions') \
                .select('id') \
                .eq('id', session_id) \
                .eq('user_id', user_id) \
                .limit(1) \
                .execute()

            data: List[Dict[str, Any]] = response.data  # type: ignore
            return bool(data)

        except Exception as e:
            # Fail closed.
            print(f"⚠️ Ownership check failed for {session_id[:8]}: {e}")
            return False
    
    def check_cache(self, query: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Per-user on purpose: a hit hands back its session id, so a global cache leaked sessions."""
        if not self.is_connected or not self.client:
            return None

        if not user_id:
            return None

        query_hash = self.generate_query_hash(query)

        try:
            response = self.client.table('research_sessions') \
                .select('*') \
                .eq('user_id', user_id) \
                .eq('query_hash', query_hash) \
                .order('created_at', desc=True) \
                .limit(1) \
                .execute()
            
            data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if data and len(data) > 0:
                cached = data[0]
                
                try:
                    if isinstance(cached.get('citations'), str):
                        cached['citations'] = json.loads(cached['citations'])
                    if isinstance(cached.get('metadata'), str):
                        cached['metadata'] = json.loads(cached['metadata'])
                except json.JSONDecodeError:
                    pass
                
                print(f"✅ Cache HIT: {query[:50]}")
                return cached
            
            return None
            
        except Exception as e:
            print(f"⚠️ Cache check failed: {e}")
            return None
    
    def save_session(
        self,
        query: str,
        report: str,
        citations: List[Dict[str, Any]],
        metadata: Dict[str, Any],
        user_id: str,
        session_id: Optional[str] = None,
        messages: Optional[List[Dict[str, Any]]] = None
    ) -> Optional[str]:
        """
        Insert the session, then its user and assistant messages in one batch. Pass
        session_id/messages to reuse ids already returned to the client.
        """
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected - skipping save")
            return None

        if not user_id:
            print("⚠️ Refusing to save an ownerless session")
            return None

        query_hash = self.generate_query_hash(query)
        
        try:
            clean_citations = [
                {k: v for k, v in cite.items() if v is not None}
                for cite in citations
            ]
            
            clean_metadata = {k: v for k, v in metadata.items() if v is not None}
            
            session_id = session_id or str(uuid.uuid4())
            
            data = {
                'id': session_id,
                'user_id': user_id,
                'query': query[:1000],
                'query_hash': query_hash,
                'report': report[:50000],
                'citations': clean_citations,
                'metadata': clean_metadata,
                'is_favorite': False,
                'created_at': datetime.now().isoformat(),
                'updated_at': datetime.now().isoformat()
            }
            
            response = self.client.table('research_sessions').insert(data).execute()
            
            result_data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if result_data and len(result_data) > 0:
                print(f"✅ Saved session: {session_id[:8]}")
                
                try:
                    if messages is None:
                        now = datetime.now()
                        messages = [
                            {
                                'role': 'user',
                                'content': query,
                                'created_at': now.isoformat()
                            },
                            {
                                'role': 'assistant',
                                'content': report,
                                'citations': clean_citations,
                                'metadata': clean_metadata,
                                # Must sort after the user message.
                                'created_at': (now + timedelta(milliseconds=1)).isoformat()
                            }
                        ]

                    thread_saved = False
                    for _ in range(2):
                        # Just created, so ownership is known and updated_at is fresh.
                        if self.add_messages_batch(
                            session_id,
                            messages,
                            user_id,
                            touch_session=False,
                            _ownership_checked=True,
                        ):
                            thread_saved = True
                            break

                    if thread_saved:
                        print(f"✅ Created initial conversation thread for {session_id[:8]}")
                    else:
                        print(f"⚠️ Failed to create initial messages (non-critical) for {session_id[:8]}")
                except Exception as msg_error:
                    print(f"⚠️ Failed to create initial messages (non-critical): {msg_error}")

                return session_id
            
            return None
            
        except Exception as e:
            # Runs in a background task, so this log is the only trace of lost research.
            logger.error(
                "Failed to save session %s (the answer was returned but NOT persisted): %s",
                session_id[:8] if session_id else "?", e,
            )
            if _is_duplicate_key(e):
                logger.error(
                    "  -> this account already has a session for that exact query; "
                    "not retrying. If the owner is a DIFFERENT account, "
                    "supabase/migrations/0004_scope_query_hash_unique.sql has not been applied."
                )
                raise DuplicateSessionError(str(e)) from e
            if not self.schema_ready:
                logger.error(
                    "  -> research_sessions.user_id is missing; apply "
                    "supabase/migrations/0001_add_user_id.sql"
                )
            return None
    
    def add_message(
        self,
        session_id: str,
        role: str,  # 'user' or 'assistant'
        content: str,
        user_id: str,
        citations: Optional[List[Dict[str, Any]]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Add one message. Returns its id, or None. user_id must own the session."""
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected - cannot save message")
            return None

        if not self.owns_session(session_id, user_id):
            print(f"🚫 Refusing to write into unowned session {session_id[:8]}")
            return None

        try:
            message_id = str(uuid.uuid4())
            
            message_data = {
                'id': message_id,
                'session_id': session_id,
                'role': role,
                'content': content[:50000],
                'citations': citations or [],
                'metadata': metadata or {},
                'created_at': datetime.now().isoformat()
            }
            
            response = self.client.table('messages').insert(message_data).execute()
            
            result_data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if result_data and len(result_data) > 0:
                print(f"💬 Message added: {role} in session {session_id[:8]}")
                
                try:
                    self.client.table('research_sessions').update({
                        'updated_at': datetime.now().isoformat()
                    }).eq('id', session_id).eq('user_id', user_id).execute()
                except Exception as update_err:
                    print(f"⚠️ Failed to update session timestamp (non-critical): {update_err}")
                
                return message_id
            
            return None
            
        except Exception as e:
            print(f"⚠️ Failed to add message: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def add_messages_batch(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        user_id: str,
        touch_session: bool = True,
        _ownership_checked: bool = False
    ) -> bool:
        """
        Insert messages in one call, keeping any supplied id/created_at. user_id must own
        the session; _ownership_checked is for save_session, which just created it.
        """
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected - cannot save messages")
            return False

        if not messages:
            return True

        if not _ownership_checked and not self.owns_session(session_id, user_id):
            print(f"🚫 Refusing to write into unowned session {session_id[:8]}")
            return False

        try:
            now = datetime.now().isoformat()
            rows = [
                {
                    'id': msg.get('id') or str(uuid.uuid4()),
                    'session_id': session_id,
                    'role': msg['role'],
                    'content': msg['content'][:50000],
                    'citations': msg.get('citations') or [],
                    'metadata': msg.get('metadata') or {},
                    'created_at': msg.get('created_at') or now
                }
                for msg in messages
            ]

            response = self.client.table('messages').insert(rows).execute()

            result_data: List[Dict[str, Any]] = response.data  # type: ignore

            if not result_data or len(result_data) != len(rows):
                print(f"⚠️ Batch insert saved {len(result_data or [])}/{len(rows)} messages")
                return False

            print(f"💬 {len(rows)} messages added in session {session_id[:8]}")

            if touch_session:
                try:
                    self.client.table('research_sessions').update({
                        'updated_at': datetime.now().isoformat()
                    }).eq('id', session_id).eq('user_id', user_id).execute()
                except Exception as update_err:
                    print(f"⚠️ Failed to update session timestamp (non-critical): {update_err}")

            return True

        except Exception as e:
            print(f"⚠️ Failed to add messages: {e}")
            return False

    def get_conversation_history(self, session_id: str, user_id: str) -> List[Dict[str, Any]]:
        """Messages in order, or [] if the session isn't the user's."""
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected - cannot retrieve messages")
            return []

        if not self.owns_session(session_id, user_id):
            print(f"🚫 Refusing to read unowned session {session_id[:8]}")
            return []

        try:
            print(f"💬 Fetching conversation history for session: {session_id[:8]}")
            
            response = self.client.table('messages') \
                .select('*') \
                .eq('session_id', session_id) \
                .order('created_at', desc=False) \
                .execute()
            
            data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if not data:
                print(f"ℹ️ No messages found for session {session_id[:8]}")
                return []
            
            parsed_messages = []
            for message in data:
                try:
                    if isinstance(message.get('citations'), str):
                        message['citations'] = json.loads(message['citations'])
                    if isinstance(message.get('metadata'), str):
                        message['metadata'] = json.loads(message['metadata'])
                    parsed_messages.append(message)
                except json.JSONDecodeError as e:
                    print(f"⚠️ JSON parse error in message: {e}")
                    parsed_messages.append(message)
            
            print(f"✅ Retrieved {len(parsed_messages)} messages for session {session_id[:8]}")
            return parsed_messages
            
        except Exception as e:
            print(f"❌ Failed to get conversation history: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def get_recent_sessions(self, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected")
            return []

        if not user_id:
            return []

        try:
            print(f"📚 Fetching {limit} recent sessions...")

            # Fall back to created_at for rows without updated_at.
            try:
                response = self.client.table('research_sessions') \
                    .select('id, query, created_at, updated_at, metadata, is_favorite') \
                    .eq('user_id', user_id) \
                    .order('updated_at', desc=True) \
                    .limit(limit) \
                    .execute()
                print("✅ Using updated_at for ordering")
            except Exception as order_error:
                print(f"⚠️ updated_at failed, using created_at: {order_error}")
                response = self.client.table('research_sessions') \
                    .select('id, query, created_at, metadata, is_favorite') \
                    .eq('user_id', user_id) \
                    .order('created_at', desc=True) \
                    .limit(limit) \
                    .execute()
            
            data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if not data:
                print("ℹ️ No sessions found in database")
                return []
            
            print(f"📊 Raw data retrieved: {len(data)} sessions")
            
            parsed_sessions = []
            for session in data:
                try:
                    if isinstance(session.get('metadata'), str):
                        session['metadata'] = json.loads(session['metadata'])
                    
                    if 'is_favorite' not in session:
                        session['is_favorite'] = False
                    
                    if 'updated_at' not in session and 'created_at' in session:
                        session['updated_at'] = session['created_at']
                    
                    parsed_sessions.append(session)
                    
                except Exception as parse_error:
                    print(f"⚠️ Parse error: {parse_error}")
                    if 'is_favorite' not in session:
                        session['is_favorite'] = False
                    parsed_sessions.append(session)
            
            print(f"✅ Retrieved {len(parsed_sessions)} sessions for history")
            
            if parsed_sessions:
                first = parsed_sessions[0]
                print(f"📝 First session: {first.get('query', 'N/A')[:50]}")
            
            return parsed_sessions
            
        except Exception as e:
            # [] looks like "no history", so log why.
            logger.error("Failed to fetch history for user %s: %s", user_id[:8] if user_id else "?", e)
            if not self.schema_ready:
                logger.error(
                    "  -> research_sessions.user_id is missing; apply "
                    "supabase/migrations/0001_add_user_id.sql"
                )
            return []
    
    def get_session_by_id(self, session_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """None if missing or not the user's, so both 404 the same way."""
        if not self.is_connected or not self.client:
            return None

        if not session_id or not user_id:
            return None

        try:
            print(f"🔍 Fetching session by ID: {session_id}")

            # .limit(1), not .single(): a miss is a normal outcome.
            response = self.client.table('research_sessions') \
                .select('*') \
                .eq('id', session_id) \
                .eq('user_id', user_id) \
                .limit(1) \
                .execute()

            rows: List[Dict[str, Any]] = response.data  # type: ignore

            if not rows:
                print(f"❌ Session not found or not owned: {session_id}")
                return None

            data: Dict[str, Any] = rows[0]

            try:
                if isinstance(data.get('citations'), str):
                    data['citations'] = json.loads(data['citations'])
                if isinstance(data.get('metadata'), str):
                    data['metadata'] = json.loads(data['metadata'])
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON parse error: {e}")
            
            print(f"✅ Session retrieved: {session_id[:8]}")
            return data
            
        except Exception as e:
            print(f"❌ Get session by ID failed: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def update_session(self, session_id: str, update_data: dict, user_id: str) -> bool:
        """Rename or favorite. False if missing or not the user's."""
        if not self.is_connected or not self.client:
            logger.error("Database not connected")
            return False
        
        try:
            if not session_id or len(session_id) < 8:
                logger.error(f"Invalid session_id: {session_id}")
                return False

            if not user_id:
                return False

            update_data['updated_at'] = datetime.now().isoformat()

            print(f"✏️ Updating session: {session_id[:8]}... with {update_data}")

            result = self.client.table('research_sessions') \
                .update(update_data) \
                .eq('id', session_id) \
                .eq('user_id', user_id) \
                .execute()
            
            if not result.data:
                logger.warning(f"❌ Session not found for update: {session_id}")
                print(f"❌ Session not found: {session_id}")
                return False
            
            logger.info(f"✅ Session updated: {session_id[:8]}... with {update_data}")
            print(f"✅ Session updated: {session_id[:8]}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to update session {session_id[:8]}: {str(e)}")
            logger.exception(e)
            print(f"❌ Update failed: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_session(self, session_id: str, user_id: str) -> bool:
        """Delete a session and its messages. False if missing or not the user's."""
        if not self.is_connected or not self.client:
            logger.error("Database not connected")
            return False
        
        try:
            if not session_id or len(session_id) < 8:
                logger.error(f"Invalid session_id: {session_id}")
                return False

            # Check ownership first: the message delete is keyed on session_id alone.
            if not self.owns_session(session_id, user_id):
                logger.warning(f"🚫 Refusing to delete unowned session: {session_id[:8]}")
                return False

            print(f"🗑️ Deleting session: {session_id[:8]}...")

            try:
                msg_result = self.client.table('messages') \
                    .delete() \
                    .eq('session_id', session_id) \
                    .execute()
                print(f"✅ Deleted {len(msg_result.data or [])} messages")
            except Exception as msg_delete_err:
                print(f"⚠️ Failed to delete messages (non-critical): {msg_delete_err}")

            result = self.client.table('research_sessions') \
                .delete() \
                .eq('id', session_id) \
                .eq('user_id', user_id) \
                .execute()
            
            if not result.data:
                logger.warning(f"❌ Session not found for deletion: {session_id}")
                print(f"❌ Session not found: {session_id}")
                return False
            
            logger.info(f"✅ Session deleted: {session_id[:8]}...")
            print(f"✅ Session deleted: {session_id[:8]}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to delete session {session_id[:8]}: {str(e)}")
            logger.exception(e)
            print(f"❌ Delete failed: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def health_check(self) -> bool:
        if not self.is_connected or not self.client:
            return False
        
        try:
            self.client.table('research_sessions').select('id').limit(1).execute()
            return True
        except:
            return False


_db_instance: Optional[VettanDatabaseV2] = None
_db_initialized: bool = False


def get_database_v2() -> Optional[VettanDatabaseV2]:
    """Shared instance, created lazily. None if the connection fails."""
    global _db_instance, _db_initialized
    
    if _db_initialized:
        return _db_instance
    
    try:
        _db_instance = VettanDatabaseV2(max_retries=3, timeout=10)
        _db_initialized = True
        return _db_instance if _db_instance.is_connected else None
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")
        import traceback
        traceback.print_exc()
        _db_initialized = True
        _db_instance = None
        return None


# Per-caller handles bound to the caller's JWT, cached by token. The shared client is
# never given a user's token: background tasks would mix up concurrent users.

_SCOPED_TTL_SECONDS = 300
_SCOPED_MAX_ENTRIES = 512

_scoped_cache: "OrderedDict[str, Tuple[float, VettanDatabaseV2]]" = OrderedDict()
_scoped_lock = threading.Lock()


def _token_cache_key(access_token: str) -> str:
    return hashlib.sha256(access_token.encode()).hexdigest()


def _prune_scoped_cache(now: float) -> None:
    """Caller must hold _scoped_lock."""
    expired = [k for k, (ts, _) in _scoped_cache.items() if now - ts > _SCOPED_TTL_SECONDS]
    for k in expired:
        _scoped_cache.pop(k, None)

    while len(_scoped_cache) > _SCOPED_MAX_ENTRIES:
        _scoped_cache.popitem(last=False)


def get_user_scoped_db(access_token: str) -> Optional[VettanDatabaseV2]:
    """Handle that runs as the caller, so RLS applies on top of the app's own user_id filters."""
    if not access_token:
        return None

    key = _token_cache_key(access_token)
    now = time.time()

    with _scoped_lock:
        entry = _scoped_cache.get(key)
        if entry and now - entry[0] <= _SCOPED_TTL_SECONDS:
            _scoped_cache.move_to_end(key)
            return entry[1]

    # Built outside the lock so first requests don't queue behind each other.
    try:
        instance = VettanDatabaseV2(access_token=access_token, verify_connection=False)
    except Exception as e:
        print(f"❌ Scoped database initialization failed: {e}")
        return None

    if not instance.is_connected:
        return None

    with _scoped_lock:
        _scoped_cache[key] = (now, instance)
        _scoped_cache.move_to_end(key)
        _prune_scoped_cache(now)

    return instance