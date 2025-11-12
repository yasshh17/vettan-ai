"""
Vettan AI Backend - Production Grade
Full conversation threading with context awareness
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
from dotenv import load_dotenv
import logging

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

from agent.cached_research_agent import cached_research
from database.supabase_client_v2 import get_database_v2
from audio.tts import get_tts

app = FastAPI(
    title="Vettan AI API",
    version="5.0.0",
    description="Enterprise AI Research Agent"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://*.vercel.app",
        "https://vettan.ai"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# MODELS
# ============================================

class ResearchRequest(BaseModel):
    query: str
    max_iterations: int = 25
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
    text: str
    voice: str = "nova"

class UpdateSessionRequest(BaseModel):
    query: Optional[str] = None
    title: Optional[str] = None
    isFavorite: Optional[bool] = None
    is_favorite: Optional[bool] = None

# ============================================
# ENDPOINTS
# ============================================

@app.get("/")
async def root():
    return {"status": "Vettan AI Backend", "version": "5.0.0"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "database": get_database_v2().is_connected if get_database_v2() else False}

@app.post("/api/research", response_model=ResearchResponse)
async def research(request: ResearchRequest):
    """
    Main research endpoint with full conversation threading
    
    CRITICAL FIXES:
    - Always returns FULL message history
    - Properly handles context for follow-ups
    - Uses OpenAI chat for follow-ups (faster, maintains context)
    """
    try:
        db = get_database_v2()
        
        logger.info("="*60)
        logger.info(f"📥 REQUEST: {request.query[:80]}")
        logger.info(f"📍 Session: {request.session_id[:8] if request.session_id else 'NEW'}")
        logger.info(f"🔄 Follow-up: {request.is_followup}")
        logger.info("="*60)
        
        # ============================================
        # FOLLOW-UP QUERY HANDLING
        # ============================================
        if request.session_id and request.is_followup:
            logger.info(f"🔄 Processing follow-up in session: {request.session_id[:8]}")
            
            if not db or not db.is_connected:
                raise HTTPException(status_code=503, detail="Database required for follow-ups")
            
            # STEP 1: Save user question
            logger.info(f"💾 Saving user message...")
            user_msg_id = db.add_message(
                session_id=request.session_id,
                role='user',
                content=request.query
            )
            
            if not user_msg_id:
                logger.error("❌ Failed to save user message!")
                raise HTTPException(status_code=500, detail="Failed to save message")
            
            logger.info(f"✅ User message saved: {user_msg_id[:8]}")
            
            # STEP 2: Get conversation history FOR CONTEXT
            logger.info(f"📚 Loading conversation history...")
            conversation_history = db.get_conversation_history(request.session_id)
            
            if not conversation_history:
                logger.error(f"❌ No history found for session: {request.session_id[:8]}")
                raise HTTPException(status_code=404, detail="Conversation not found")
            
            logger.info(f"✅ Loaded {len(conversation_history)} messages")
            
            # Log each message for debugging
            for i, msg in enumerate(conversation_history, 1):
                logger.info(f"  📝 Message {i} ({msg['role']}): {msg['content'][:50]}...")
            
            # STEP 3: Build context for AI (exclude current question)
            previous_messages = conversation_history[:-1]
            
            logger.info(f"🧠 Building AI context from {len(previous_messages)} previous messages")
            
            # STEP 4: Use OpenAI Chat (NOT research) for follow-ups
            try:
                from openai import OpenAI
                client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
                
                # Build message array for OpenAI
                messages_for_ai = []
                
                # Add system message for context
                messages_for_ai.append({
                    "role": "system",
                    "content": "You are Vettan AI, a research assistant. Answer follow-up questions based on the conversation context. Be direct and reference previous research when relevant."
                })
                
                # Add recent conversation history (last 6 messages = 3 Q&A pairs)
                for msg in previous_messages[-6:]:
                    messages_for_ai.append({
                        "role": msg['role'],
                        "content": msg['content'][:3000]  # Truncate if needed
                    })
                
                # Add current question
                messages_for_ai.append({
                    "role": "user",
                    "content": request.query
                })
                
                logger.info(f"💬 Sending {len(messages_for_ai)} messages to OpenAI GPT-4")
                
                # Generate response with full context
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages_for_ai,
                    temperature=0.7,
                    max_tokens=2000
                )
                
                ai_content = response.choices[0].message.content
                tokens_used = response.usage.total_tokens
                
                logger.info(f"✅ AI response generated: {len(ai_content)} chars, {tokens_used} tokens")
                
            except Exception as openai_error:
                logger.error(f"❌ OpenAI API error: {openai_error}")
                raise HTTPException(status_code=500, detail=f"AI generation failed: {str(openai_error)}")
            
            # STEP 5: Save AI response
            logger.info("💾 Saving AI response...")
            assistant_msg_id = db.add_message(
                session_id=request.session_id,
                role='assistant',
                content=ai_content,
                citations=[],
                metadata={
                    'model': 'gpt-4o-mini',
                    'tokens': tokens_used,
                    'is_followup': True,
                    'context_messages': len(messages_for_ai)
                }
            )
            
            if not assistant_msg_id:
                logger.error("❌ Failed to save assistant message!")
            else:
                logger.info(f"✅ Assistant message saved: {assistant_msg_id[:8]}")
            
            # STEP 6: Get COMPLETE conversation thread
            logger.info("📖 Fetching complete conversation thread...")
            all_messages = db.get_conversation_history(request.session_id)
            
            logger.info(f"✅ Thread has {len(all_messages)} total messages")
            logger.info("📋 Complete thread:")
            for i, msg in enumerate(all_messages, 1):
                logger.info(f"  {i}. {msg['role']}: {msg['content'][:60]}...")
            
            # STEP 7: Format for frontend
            formatted_messages = [
                Message(
                    id=msg['id'],
                    role=msg['role'],
                    content=msg['content'],
                    citations=msg.get('citations', []),
                    metadata=msg.get('metadata', {}),
                    created_at=msg['created_at']
                )
                for msg in all_messages
            ]
            
            logger.info("="*60)
            logger.info(f"✅ FOLLOW-UP COMPLETE: Returning {len(formatted_messages)} messages")
            logger.info("="*60)
            
            return ResearchResponse(
                output=ai_content,
                citations=[],
                metadata={
                    'model': 'gpt-4o-mini',
                    'tokens': tokens_used,
                    'is_followup': True,
                    'message_count': len(formatted_messages)
                },
                session_id=request.session_id,
                messages=formatted_messages
            )
        
        # ============================================
        # NEW CONVERSATION
        # ============================================
        logger.info(f"🆕 NEW conversation: {request.query[:100]}")
        
        result = cached_research(
            request.query,
            max_iterations=request.max_iterations,
            use_cache=request.use_cache,
            save_to_db=True
        )
        
        session_id = result.get('metadata', {}).get('session_id', 'unknown')
        
        if session_id == 'unknown':
            logger.error("❌ No session ID returned from research!")
            raise HTTPException(status_code=500, detail="Failed to create session")
        
        logger.info(f"✅ Session created: {session_id[:8]}")
        
        # Get initial messages (should be 2)
        if db and db.is_connected:
            all_messages = db.get_conversation_history(session_id)
            logger.info(f"📖 Loaded {len(all_messages)} initial messages")
            
            formatted_messages = [
                Message(
                    id=msg['id'],
                    role=msg['role'],
                    content=msg['content'],
                    citations=msg.get('citations', []),
                    metadata=msg.get('metadata', {}),
                    created_at=msg['created_at']
                )
                for msg in all_messages
            ]
        else:
            logger.warning("⚠️ Database unavailable, using fallback")
            formatted_messages = [
                Message(
                    id='temp-user',
                    role='user',
                    content=request.query,
                    created_at=''
                ),
                Message(
                    id='temp-assistant',
                    role='assistant',
                    content=result['output'],
                    citations=result.get('citations', []),
                    metadata=result.get('metadata', {}),
                    created_at=''
                )
            ]
        
        logger.info("="*60)
        logger.info(f"✅ NEW CONVERSATION COMPLETE: {len(formatted_messages)} messages")
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
        logger.error(f"❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/{session_id}/messages")
async def get_session_messages(session_id: str):
    """Get all messages in conversation thread"""
    try:
        logger.info(f"💬 Fetching messages for session: {session_id[:8]}")
        
        db = get_database_v2()
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")
        
        messages = db.get_conversation_history(session_id)
        
        if not messages:
            logger.warning(f"⚠️ No messages found for: {session_id[:8]}")
            return {"session_id": session_id, "messages": [], "count": 0}
        
        logger.info(f"✅ Found {len(messages)} messages")
        
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
        logger.error(f"❌ Message fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/audio")
async def generate_audio(request: AudioRequest):
    """Generate audio from text"""
    try:
        if not request.text:
            raise HTTPException(status_code=400, detail="No text provided")
        
        logger.info(f"🎙️ Generating audio: {len(request.text)} chars, voice: {request.voice}")
        
        tts = get_tts()
        speech_text = tts.prepare_text_for_speech(request.text)
        audio_bytes = tts.generate_audio(text=speech_text, voice=request.voice)
        
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Audio generation failed")
        
        import base64
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        cost = tts.estimate_cost(speech_text)
        
        logger.info(f"✅ Audio generated: {len(audio_bytes)} bytes")
        
        return {
            "audio": audio_b64,
            "cost": cost,
            "length_chars": len(speech_text),
            "voice": request.voice,
            "format": "mp3"
        }
        
    except Exception as e:
        logger.error(f"❌ Audio generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history")
async def get_history(limit: int = 50):
    """Get conversation history"""
    try:
        logger.info(f"📚 Fetching history: limit={limit}")
        
        db = get_database_v2()
        if db and db.is_connected:
            sessions = db.get_recent_sessions(limit=limit)
            
            formatted_sessions = [
                {
                    "id": s["id"],
                    "query": s["query"],
                    "created_at": s["created_at"],
                    "is_favorite": s.get("is_favorite", False)
                }
                for s in sessions
            ]
            
            logger.info(f"✅ Retrieved {len(formatted_sessions)} sessions")
            return {"sessions": formatted_sessions}
        
        logger.warning("⚠️ Database not connected")
        return {"sessions": []}
        
    except Exception as e:
        logger.error(f"❌ History fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/{session_id}")
async def get_session(session_id: str):
    """
    Get complete session with FULL message history
    
    CRITICAL: Always returns ALL messages in thread
    """
    try:
        logger.info("="*60)
        logger.info(f"🔍 GET SESSION: {session_id[:8]}")
        logger.info("="*60)
        
        db = get_database_v2()
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")
        
        # Get session metadata
        session_data = db.get_session_by_id(session_id)
        if not session_data:
            logger.error(f"❌ Session not found: {session_id[:8]}")
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"✅ Session found: {session_data.get('query', 'N/A')[:50]}")
        
        # Get FULL message history
        messages = db.get_conversation_history(session_id)
        
        if not messages:
            logger.warning(f"⚠️ No messages found for session: {session_id[:8]}")
            messages = []
        else:
            logger.info(f"📖 Loaded {len(messages)} messages from database")
            for i, msg in enumerate(messages, 1):
                logger.info(f"  {i}. {msg['role']}: {msg['content'][:60]}...")
        
        # Format messages
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
        logger.info(f"✅ RETURNING {len(formatted_messages)} messages to frontend")
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
        logger.error(f"❌ Session fetch failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/history/{session_id}")
@app.put("/api/history/{session_id}")
async def update_session(session_id: str, request: UpdateSessionRequest):
    """Update session (rename/favorite)"""
    try:
        logger.info(f"✏️ Updating session: {session_id[:8]}")
        
        db = get_database_v2()
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")
        
        new_title = request.query or request.title
        is_favorite = request.is_favorite if request.is_favorite is not None else request.isFavorite
        
        if not new_title and is_favorite is None:
            raise HTTPException(status_code=400, detail="Must provide title or favorite status")
        
        update_data = {}
        if new_title:
            update_data['query'] = new_title
            logger.info(f"📝 New title: {new_title[:50]}")
        if is_favorite is not None:
            update_data['is_favorite'] = is_favorite
            logger.info(f"⭐ Favorite: {is_favorite}")
        
        success = db.update_session(session_id, update_data)
        
        if not success:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"✅ Session updated successfully")
        
        return {
            "success": True,
            "message": "Session updated",
            "session_id": session_id,
            "updates": update_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Update failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/history/{session_id}")
async def delete_session(session_id: str):
    """Delete session and all messages"""
    try:
        logger.info(f"🗑️ Deleting session: {session_id[:8]}")
        
        db = get_database_v2()
        if not db or not db.is_connected:
            raise HTTPException(status_code=503, detail="Database not connected")
        
        success = db.delete_session(session_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"✅ Session deleted successfully")
        
        return {
            "success": True,
            "message": "Session deleted",
            "session_id": session_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Delete failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info("="*60)
    logger.info("🚀 VETTAN AI BACKEND v5.0.0 STARTING")
    logger.info("="*60)
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")