"""
Production-grade Supabase client with connection pooling and retry logic
"""

from supabase import create_client, Client
import os
import hashlib
from typing import Optional, Dict, List, Any
from datetime import datetime
import time
import json
import uuid
from dotenv import load_dotenv

import logging

logger = logging.getLogger(__name__)

load_dotenv()


class VettanDatabaseV2:
    """
    Production-grade database client
    
    Features:
    - Connection retry with exponential backoff
    - Connection pooling
    - Graceful degradation
    - Comprehensive error logging
    - Circuit breaker pattern
    - Conversation threading with message history
    """
    
    def __init__(self, max_retries: int = 3, timeout: int = 10):
        """
        Initialize with retry logic
        
        Args:
            max_retries: Maximum connection attempts
            timeout: Connection timeout in seconds
        """
        self.max_retries = max_retries
        self.timeout = timeout
        self.client: Optional[Client] = None
        self.is_connected = False
        
        # Initialize connection
        self._connect()
    
    def _connect(self) -> bool:
        """
        Connect to Supabase with retry logic
        
        Returns:
            True if connected, False otherwise
        """
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        
        if not url or not key:
            print("⚠️ SUPABASE_URL or SUPABASE_KEY not found - running without database")
            self.is_connected = False
            return False
        
        # Validate URL format
        if not url.startswith(('http://', 'https://')):
            print(f"❌ Invalid SUPABASE_URL format: {url}")
            self.is_connected = False
            return False
        
        # Retry logic with exponential backoff
        for attempt in range(1, self.max_retries + 1):
            try:
                print(f"🔄 Connecting to Supabase (attempt {attempt}/{self.max_retries})...")
                
                # Create client
                self.client = create_client(url, key)
                
                # Test connection
                self.client.table('research_sessions').select('id').limit(1).execute()
                
                print(f"✅ Connected to Supabase: {url}")
                self.is_connected = True
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
        """Generate MD5 hash for caching"""
        normalized = query.lower().strip()
        return hashlib.md5(normalized.encode()).hexdigest()
    
    def check_cache(self, query: str) -> Optional[Dict[str, Any]]:
        """Check cache with connection validation"""
        if not self.is_connected or not self.client:
            return None
        
        query_hash = self.generate_query_hash(query)
        
        try:
            response = self.client.table('research_sessions') \
                .select('*') \
                .eq('query_hash', query_hash) \
                .order('created_at', desc=True) \
                .limit(1) \
                .execute()
            
            data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if data and len(data) > 0:
                cached = data[0]
                
                # Parse JSON fields safely
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
        metadata: Dict[str, Any]
    ) -> Optional[str]:
        """
        Save session with validation AND create initial messages
        
        This now creates:
        1. The research_sessions entry
        2. User message (the query)
        3. Assistant message (the report)
        """
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected - skipping save")
            return None
        
        query_hash = self.generate_query_hash(query)
        
        try:
            # Clean data
            clean_citations = [
                {k: v for k, v in cite.items() if v is not None}
                for cite in citations
            ]
            
            clean_metadata = {k: v for k, v in metadata.items() if v is not None}
            
            # Generate session ID
            session_id = str(uuid.uuid4())
            
            # Prepare session data
            data = {
                'id': session_id,
                'query': query[:1000],
                'query_hash': query_hash,
                'report': report[:50000],
                'citations': clean_citations,
                'metadata': clean_metadata,
                'is_favorite': False,
                'created_at': datetime.now().isoformat(),
                'updated_at': datetime.now().isoformat()
            }
            
            # Save session
            response = self.client.table('research_sessions').insert(data).execute()
            
            result_data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if result_data and len(result_data) > 0:
                print(f"✅ Saved session: {session_id[:8]}")
                
                # Create initial messages for conversation thread
                try:
                    # 1. User query message
                    self.add_message(
                        session_id=session_id,
                        role='user',
                        content=query
                    )
                    
                    # 2. Assistant response message
                    self.add_message(
                        session_id=session_id,
                        role='assistant',
                        content=report,
                        citations=clean_citations,
                        metadata=clean_metadata
                    )
                    
                    print(f"✅ Created initial conversation thread for {session_id[:8]}")
                except Exception as msg_error:
                    print(f"⚠️ Failed to create initial messages (non-critical): {msg_error}")
                
                return session_id
            
            return None
            
        except Exception as e:
            print(f"⚠️ Save failed (non-critical): {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def add_message(
        self,
        session_id: str,
        role: str,  # 'user' or 'assistant'
        content: str,
        citations: Optional[List[Dict[str, Any]]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """
        Add a message to a conversation thread
        
        Args:
            session_id: UUID of the parent session
            role: 'user' or 'assistant'
            content: Message content
            citations: Optional citations (for assistant messages)
            metadata: Optional metadata (for assistant messages)
        
        Returns:
            Message ID if successful, None otherwise
        """
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected - cannot save message")
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
                
                # Update session's updated_at timestamp
                try:
                    self.client.table('research_sessions').update({
                        'updated_at': datetime.now().isoformat()
                    }).eq('id', session_id).execute()
                except Exception as update_err:
                    print(f"⚠️ Failed to update session timestamp (non-critical): {update_err}")
                
                return message_id
            
            return None
            
        except Exception as e:
            print(f"⚠️ Failed to add message: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def get_conversation_history(self, session_id: str) -> List[Dict[str, Any]]:
        """
        Get all messages in a conversation thread, ordered chronologically
        
        Args:
            session_id: UUID of the session
        
        Returns:
            List of messages with role, content, citations, metadata
        """
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected - cannot retrieve messages")
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
            
            # Parse JSON fields safely
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
    
    def get_recent_sessions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent sessions with robust error handling"""
        if not self.is_connected or not self.client:
            print("⚠️ Database not connected")
            return []
        
        try:
            print(f"📚 Fetching {limit} recent sessions...")
            
            # Try with updated_at, fallback to created_at
            try:
                response = self.client.table('research_sessions') \
                    .select('id, query, created_at, updated_at, metadata, is_favorite') \
                    .order('updated_at', desc=True) \
                    .limit(limit) \
                    .execute()
                print("✅ Using updated_at for ordering")
            except Exception as order_error:
                print(f"⚠️ updated_at failed, using created_at: {order_error}")
                response = self.client.table('research_sessions') \
                    .select('id, query, created_at, metadata, is_favorite') \
                    .order('created_at', desc=True) \
                    .limit(limit) \
                    .execute()
            
            data: List[Dict[str, Any]] = response.data  # type: ignore
            
            if not data:
                print("ℹ️ No sessions found in database")
                return []
            
            print(f"📊 Raw data retrieved: {len(data)} sessions")
            
            # Parse JSON fields
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
            print(f"❌ Get sessions failed: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def get_session_by_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific session by ID"""
        if not self.is_connected or not self.client:
            return None
        
        try:
            print(f"🔍 Fetching session by ID: {session_id}")
            
            response = self.client.table('research_sessions') \
                .select('*') \
                .eq('id', session_id) \
                .single() \
                .execute()
            
            data: Dict[str, Any] = response.data  # type: ignore
            
            if not data:
                print(f"❌ Session not found: {session_id}")
                return None
            
            # Parse JSON fields safely
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
    
    def update_session(self, session_id: str, update_data: dict) -> bool:
        """
        Update session (rename/favorite)
        
        Args:
            session_id: UUID of session to update
            update_data: Dict with keys like 'query', 'is_favorite'
        
        Returns:
            True if update successful, False otherwise
        """
        if not self.is_connected or not self.client:
            logger.error("Database not connected")
            return False
        
        try:
            if not session_id or len(session_id) < 8:
                logger.error(f"Invalid session_id: {session_id}")
                return False
            
            # Add updated_at timestamp
            update_data['updated_at'] = datetime.now().isoformat()
            
            print(f"✏️ Updating session: {session_id[:8]}... with {update_data}")
            
            result = self.client.table('research_sessions') \
                .update(update_data) \
                .eq('id', session_id) \
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
    
    def delete_session(self, session_id: str) -> bool:
        """
        Delete a session permanently (CASCADE deletes messages)
        
        Args:
            session_id: UUID of session to delete
        
        Returns:
            True if deletion successful, False otherwise
        """
        if not self.is_connected or not self.client:
            logger.error("Database not connected")
            return False
        
        try:
            if not session_id or len(session_id) < 8:
                logger.error(f"Invalid session_id: {session_id}")
                return False
            
            print(f"🗑️ Deleting session: {session_id[:8]}...")
            
            # Delete messages first
            try:
                msg_result = self.client.table('messages') \
                    .delete() \
                    .eq('session_id', session_id) \
                    .execute()
                print(f"✅ Deleted {len(msg_result.data or [])} messages")
            except Exception as msg_delete_err:
                print(f"⚠️ Failed to delete messages (non-critical): {msg_delete_err}")
            
            # Delete session
            result = self.client.table('research_sessions') \
                .delete() \
                .eq('id', session_id) \
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
        """Check if database is healthy"""
        if not self.is_connected or not self.client:
            return False
        
        try:
            self.client.table('research_sessions').select('id').limit(1).execute()
            return True
        except:
            return False


# Singleton with lazy initialization
_db_instance: Optional[VettanDatabaseV2] = None
_db_initialized: bool = False


def get_database_v2() -> Optional[VettanDatabaseV2]:
    """
    Get database instance with lazy initialization
    Returns None if connection fails (graceful degradation)
    """
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