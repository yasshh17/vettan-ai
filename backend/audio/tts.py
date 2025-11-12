
"""
OpenAI TTS with full-length audio support via intelligent chunking
Handles reports up to 15,000 characters (~10 minutes audio)
"""

from openai import OpenAI
import os
from typing import Optional, List
import re
from dotenv import load_dotenv

load_dotenv()


class VettanTTS:
    """Text-to-Speech with support for long reports"""
    
    VOICES = {
        'nova': 'Female, warm, friendly',
        'alloy': 'Neutral, balanced',
        'echo': 'Male, clear',
        'fable': 'British, expressive',
        'onyx': 'Deep, authoritative',
        'shimmer': 'Female, energetic'
    }
    
    DEFAULT_VOICE = "nova"
    
    # OpenAI TTS limits
    MAX_CHARS_PER_REQUEST = 4096  # OpenAI's hard limit
    SAFE_CHUNK_SIZE = 3900  # Leave buffer for safety
    RECOMMENDED_MAX = 15000  # ~10 min audio
    
    def __init__(self):
        """Initialize OpenAI client"""
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY required")
        
        self.client = OpenAI(api_key=api_key)
        print("✅ TTS initialized")
    
    def generate_audio(
        self,
        text: str,
        voice: str = DEFAULT_VOICE,
        model: str = "tts-1"
    ) -> Optional[bytes]:
        """
        Generate audio for FULL-LENGTH text
        Automatically chunks if needed and concatenates seamlessly
        
        Args:
            text: Full text to convert (up to 15,000 chars)
            voice: Voice name
            model: TTS model
            
        Returns:
            Complete audio bytes (full report)
        """
        try:
            original_length = len(text)
            
            # Warn if extremely long
            if len(text) > self.RECOMMENDED_MAX:
                print(f"⚠️ Report is {len(text):,} chars - truncating to {self.RECOMMENDED_MAX:,} for reasonable listening time")
                text = text[:self.RECOMMENDED_MAX] + " ...End of report. Download the full text to read complete content."
            
            print(f"📝 Generating audio for {len(text):,} characters...")
            
            # Single request if fits
            if len(text) <= self.SAFE_CHUNK_SIZE:
                return self._generate_single(text, voice, model)
            
            # Multi-chunk for long text
            print(f"📦 Text exceeds single request limit - using chunked generation")
            return self._generate_chunked(text, voice, model)
            
        except Exception as e:
            print(f"❌ TTS error: {e}")
            return None
    
    def _generate_single(self, text: str, voice: str, model: str) -> Optional[bytes]:
        """Generate audio in single request"""
        print(f"🎵 Generating {len(text):,} chars with '{voice}'...")
        
        response = self.client.audio.speech.create(
            model=model,
            voice=voice,
            input=text,
            response_format="mp3"
        )
        
        audio_bytes = response.content
        print(f"✅ Generated {len(audio_bytes):,} bytes of audio")
        
        return audio_bytes if audio_bytes and len(audio_bytes) > 1000 else None
    
    def _generate_chunked(self, text: str, voice: str, model: str) -> Optional[bytes]:
        """
        Generate audio for long text via chunking + concatenation
        """
        # Split into safe-sized chunks at paragraph boundaries
        chunks = self._smart_chunk(text, max_size=self.SAFE_CHUNK_SIZE)
        
        print(f"📦 Split into {len(chunks)} chunks for generation")
        
        # Generate audio for each chunk
        audio_parts: List[bytes] = []
        
        for i, chunk in enumerate(chunks, 1):
            print(f"🎵 Chunk {i}/{len(chunks)}: {len(chunk):,} chars...")
            
            try:
                response = self.client.audio.speech.create(
                    model=model,
                    voice=voice,
                    input=chunk,
                    response_format="mp3"
                )
                
                chunk_audio = response.content
                audio_parts.append(chunk_audio)
                print(f"   ✅ Generated {len(chunk_audio):,} bytes")
                
            except Exception as e:
                print(f"   ❌ Chunk {i} failed: {e}")
                # If one chunk fails, return what we have so far
                if audio_parts:
                    print(f"   ⚠️ Returning partial audio ({i-1} chunks)")
                    break
                return None
        
        # Concatenate all chunks
        if not audio_parts:
            return None
        
        combined_audio = b''.join(audio_parts)
        print(f"✅ Combined {len(audio_parts)} chunks → {len(combined_audio):,} total bytes")
        print(f"🎉 Full audio ready! Estimated duration: ~{len(text)/200:.1f} minutes")
        
        return combined_audio
    
    def _smart_chunk(self, text: str, max_size: int) -> List[str]:
        """
        Split text at natural boundaries (paragraphs, sentences)
        
        Strategy:
        1. Split by double newlines (paragraphs)
        2. If paragraph too long, split by sentences
        3. Keep chunks under max_size
        """
        chunks: List[str] = []
        current_chunk = ""
        
        # Split by paragraphs
        paragraphs = re.split(r'\n\n+', text)
        
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            # If adding paragraph exceeds limit
            if len(current_chunk) + len(para) + 2 > max_size:
                # Save current chunk if it has content
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                
                # If single paragraph is too long, split by sentences
                if len(para) > max_size:
                    sentences = re.split(r'(?<=[.!?])\s+', para)
                    for sentence in sentences:
                        if len(current_chunk) + len(sentence) + 1 > max_size:
                            if current_chunk:
                                chunks.append(current_chunk.strip())
                            current_chunk = sentence
                        else:
                            current_chunk += " " + sentence if current_chunk else sentence
                else:
                    current_chunk = para
            else:
                current_chunk += "\n\n" + para if current_chunk else para
        
        # Add final chunk
        if current_chunk:
            chunks.append(current_chunk.strip())
        
        return chunks
    
    def prepare_text_for_speech(self, markdown_text: str) -> str:
        """Clean markdown for natural speech (NO LENGTH LIMIT)"""
        text = markdown_text
        
        # Remove markdown formatting
        text = re.sub(r'^#+\s+', '', text, flags=re.MULTILINE)
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
        text = re.sub(r'\*\*([^\*]+)\*\*', r'\1', text)
        text = re.sub(r'\*([^\*]+)\*', r'\1', text)
        text = re.sub(r'^\s*[-*•]\d*\.?\s+', '', text, flags=re.MULTILINE)
        text = re.sub(r'\[Source:[^\]]+\]', '', text)
        text = re.sub(r'```[^`]*```', '', text)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        
        # Clean whitespace but preserve paragraph breaks
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        
        # Add intro
        text = f"Here is your Vettan AI research report. {text.strip()}"
        
        return text
    
    def estimate_cost(self, text: str) -> float:
        """Estimate cost for full text"""
        char_count = min(len(text), self.RECOMMENDED_MAX)
        return (char_count / 1_000_000) * 15.0


_tts_instance = None


def get_tts() -> VettanTTS:
    """Get TTS instance"""
    global _tts_instance
    if _tts_instance is None:
        _tts_instance = VettanTTS()
    return _tts_instance
