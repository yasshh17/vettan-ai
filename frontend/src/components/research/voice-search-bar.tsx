import React, { useState, useRef, useEffect } from 'react';
import { Mic, AudioWaveform, ArrowUp } from 'lucide-react';

// Extend Window interface for Speech Recognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface VoiceSearchBarProps {
  onSubmit: (query: string) => void;
  placeholder?: string;
}

export function VoiceSearchBar({ onSubmit, placeholder = "Ask anything..." }: VoiceSearchBarProps) {
  const [query, setQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [showMicTooltip, setShowMicTooltip] = useState(false);
  const [showVoiceModeTooltip, setShowVoiceModeTooltip] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const micTooltipTimer = useRef<number | null>(null);
  const voiceModeTooltipTimer = useRef<number | null>(null);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'en-US';

        recognitionRef.current.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0])
            .map((result: any) => result.transcript)
            .join('');
          
          setQuery(transcript);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const handleDictate = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleVoiceMode = () => {
    setIsVoiceMode(!isVoiceMode);
    
    // In production, integrate with your voice conversation API
    if (!isVoiceMode) {
      console.log('Voice mode activated');
      // Initialize continuous voice conversation
    } else {
      console.log('Voice mode deactivated');
      // Close voice conversation
    }
  };

  const handleSubmit = () => {
    if (query.trim()) {
      onSubmit(query.trim());
      setQuery('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleMicMouseEnter = () => {
    if (micTooltipTimer.current) window.clearTimeout(micTooltipTimer.current);
    micTooltipTimer.current = window.setTimeout(() => setShowMicTooltip(true), 200);
  };

  const handleMicMouseLeave = () => {
    if (micTooltipTimer.current) window.clearTimeout(micTooltipTimer.current);
    setShowMicTooltip(false);
  };

  const handleVoiceModeMouseEnter = () => {
    if (voiceModeTooltipTimer.current) window.clearTimeout(voiceModeTooltipTimer.current);
    voiceModeTooltipTimer.current = window.setTimeout(() => setShowVoiceModeTooltip(true), 200);
  };

  const handleVoiceModeMouseLeave = () => {
    if (voiceModeTooltipTimer.current) window.clearTimeout(voiceModeTooltipTimer.current);
    setShowVoiceModeTooltip(false);
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="relative">
        {/* Main Search Container */}
        <div className="relative bg-neutral-800 border border-neutral-700 rounded-2xl shadow-lg hover:border-neutral-600 transition-colors duration-200">
          <div className="flex items-center gap-2 p-3">
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              className="flex-1 bg-transparent text-neutral-200 placeholder:text-neutral-500 resize-none outline-none text-base px-2 py-2 max-h-32 overflow-y-auto"
              style={{
                minHeight: '40px',
                scrollbarWidth: 'thin',
                scrollbarColor: '#404040 transparent'
              }}
            />

            {/* Action Buttons Container */}
            <div className="flex items-center gap-2">
              {/* Microphone Button (Dictate) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleDictate}
                  onMouseEnter={handleMicMouseEnter}
                  onMouseLeave={handleMicMouseLeave}
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    transition-all duration-200
                    ${isListening 
                      ? 'bg-red-500 text-white animate-pulse' 
                      : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300 hover:text-neutral-100'
                    }
                    active:scale-95
                  `}
                  aria-label={isListening ? "Stop dictation" : "Start dictation"}
                >
                  <Mic className="w-5 h-5" />
                </button>

                {/* Dictate Tooltip */}
                {showMicTooltip && !isListening && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-neutral-900 text-neutral-200 text-sm rounded-lg whitespace-nowrap pointer-events-none animate-in fade-in duration-200 shadow-lg border border-neutral-700 z-50">
                    Dictate
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                )}
              </div>

              {/* Voice Mode Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={handleVoiceMode}
                  onMouseEnter={handleVoiceModeMouseEnter}
                  onMouseLeave={handleVoiceModeMouseLeave}
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    transition-all duration-200
                    ${isVoiceMode 
                      ? 'bg-purple-500 text-white' 
                      : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300 hover:text-neutral-100'
                    }
                    active:scale-95
                  `}
                  aria-label={isVoiceMode ? "Exit voice mode" : "Enter voice mode"}
                >
                  <AudioWaveform className="w-5 h-5" />
                </button>

                {/* Voice Mode Tooltip */}
                {showVoiceModeTooltip && !isVoiceMode && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-neutral-900 text-neutral-200 text-sm rounded-lg whitespace-nowrap pointer-events-none animate-in fade-in duration-200 shadow-lg border border-neutral-700 z-50">
                    Use voice mode
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-neutral-900"></div>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!query.trim()}
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center
                  transition-all duration-200
                  ${query.trim()
                    ? 'bg-purple-500 hover:bg-purple-600 text-white cursor-pointer' 
                    : 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                  }
                  active:scale-95
                `}
                aria-label="Submit query"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Voice Status Indicator */}
        {isListening && (
          <div className="mt-2 text-center">
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-red-500/20 text-red-400 text-sm rounded-full animate-in fade-in duration-200">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              Listening...
            </span>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-neutral-500 text-xs text-center mt-3">
          Vettan AI can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}