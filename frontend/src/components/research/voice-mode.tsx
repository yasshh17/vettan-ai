"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Mic, MicOff } from 'lucide-react'
import { refreshHistory } from '@/lib/api'
import { authFetch } from '@/lib/auth-fetch'

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'

interface VoiceModeProps {
  isOpen: boolean
  onClose: () => void
}

export function VoiceMode({ isOpen, onClose }: VoiceModeProps) {
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const [response, setResponse] = useState('')
  const [sourceCount, setSourceCount] = useState(0)
  const [micPermissionDenied, setMicPermissionDenied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recognitionRef = useRef<any>(null)
  const animationFrameRef = useRef<number>(0)
  const isInitializedRef = useRef(false)

  const processVoiceInput = async (text: string) => {
    if (!text.trim()) return

    setState('processing')
    setSourceCount(0)

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (e) {
      }
    }

    try {
      const response = await authFetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          max_iterations: 25,
          use_cache: true
        })
      })

      const data = await response.json()

      // Refresh the sidebar history so the new session shows up immediately
      refreshHistory()

      setSourceCount(data.citations?.length || 0)
      setResponse(data.output)
      await speakResponse(data.output)

    } catch (error) {
      console.error('Voice processing error:', error)
      setTimeout(() => {
        if (recognitionRef.current && isOpen) {
          try {
            recognitionRef.current.start()
            setState('listening')
          } catch (e) {
            setState('idle')
          }
        }
      }, 1000)
    }
  }

  const speakResponse = async (text: string) => {
    setState('speaking')

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.1
    utterance.pitch = 1.0
    utterance.volume = 1.0

    utterance.onend = () => {
      setTimeout(() => {
        if (recognitionRef.current && isOpen) {
          try {
            recognitionRef.current.start()
            setState('listening')
            setTranscript('')
          } catch (e) {
            setState('idle')
          }
        }
      }, 500)
    }

    window.speechSynthesis.speak(utterance)
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen) return

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    
    if (!SpeechRecognition) {
      alert('Speech recognition not supported. Please use Chrome, Edge, or Safari.')
      return
    }

    if (!recognitionRef.current) {
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = true
      recognitionRef.current.interimResults = true
      recognitionRef.current.lang = 'en-US'

      recognitionRef.current.onstart = () => {
        console.log('🎤 Microphone started')
        setState('listening')
      }

      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('')
        
        setTranscript(transcript)

        if (event.results[event.results.length - 1].isFinal) {
          processVoiceInput(transcript)
        }
      }

      recognitionRef.current.onend = () => {
        console.log('Recognition ended, current state:', state)
        if (state === 'listening' && isOpen) {
          setTimeout(() => {
            if (recognitionRef.current && isOpen) {
              try {
                recognitionRef.current.start()
              } catch (e) {
                console.error('Failed to restart:', e)
                setState('idle')
              }
            }
          }, 100)
        }
      }

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error)
        if (event.error === 'not-allowed') {
          setMicPermissionDenied(true)
          setState('idle')
          alert('Microphone access denied. Please enable microphone permissions in your browser settings.')
        } else if (event.error !== 'aborted') {
          setTimeout(() => {
            if (recognitionRef.current && isOpen && state === 'listening') {
              try {
                recognitionRef.current.start()
              } catch (e) {
                setState('idle')
              }
            }
          }, 1000)
        }
      }
    }

    // CRITICAL: Start listening immediately when component mounts with isOpen=true
    if (!isInitializedRef.current) {
      isInitializedRef.current = true
      
      console.log('🎙️ Voice mode opened - auto-starting in 300ms')
      
      const startTimer = setTimeout(() => {
        if (recognitionRef.current && isOpen) {
          try {
            console.log('🚀 Attempting to start recognition...')
            recognitionRef.current.start()
          } catch (error: any) {
            console.error('❌ Failed to start recognition:', error)
            if (error.name === 'NotAllowedError') {
              setMicPermissionDenied(true)
              alert('Microphone access denied. Please enable microphone permissions.')
            }
          }
        }
      }, 300)

      return () => clearTimeout(startTimer)
    }
  }, [isOpen, state])

  useEffect(() => {
    if (!isOpen) {
      isInitializedRef.current = false
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch (e) {
        }
      }
      window.speechSynthesis.cancel()
      setState('idle')
      setTranscript('')
      setMicPermissionDenied(false)
    }
  }, [isOpen])

  // Mic button acts as MUTE/UNMUTE toggle
  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition not supported. Use Chrome, Edge, or Safari.')
      return
    }

    if (state === 'listening') {
      // MUTE: Stop listening
      try {
        recognitionRef.current.stop()
        setState('idle')
        console.log('🔇 Muted')
      } catch (e) {
        console.error('Failed to stop:', e)
      }
    } else if (state === 'idle') {
      // UNMUTE: Resume listening
      try {
        recognitionRef.current.start()
        setState('listening')
        console.log('🔊 Unmuted')
      } catch (error: any) {
        console.error('Failed to start:', error)
        if (error.name === 'NotAllowedError') {
          setMicPermissionDenied(true)
          alert('Microphone access denied.')
        }
      }
    }
  }

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = 400
    canvas.height = 400

    const particles: Array<{
      x: number
      y: number
      vx: number
      vy: number
      radius: number
    }> = []

    const particleCount = state === 'listening' ? 800 : 500
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const distance = Math.random() * 150
      particles.push({
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * 1.5 + 0.5
      })
    }

    const animate = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      particles.forEach(particle => {
        particle.x += particle.vx
        particle.y += particle.vy

        // Gravitational pull toward center
        const dx = centerX - particle.x
        const dy = centerY - particle.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance > 150) {
          particle.vx += dx * 0.0001
          particle.vy += dy * 0.0001
        }

        if (state === 'listening' || state === 'speaking') {
          particle.vx += (Math.random() - 0.5) * 0.1
          particle.vy += (Math.random() - 0.5) * 0.1
        }

        particle.vx *= 0.99
        particle.vy *= 0.99

        const alpha = state === 'listening' ? 0.8 : state === 'speaking' ? 0.6 : 0.4
        ctx.fillStyle = state === 'listening' 
          ? `rgba(168, 85, 247, ${alpha})` 
          : state === 'speaking'
          ? `rgba(99, 102, 241, ${alpha})`
          : `rgba(100, 116, 139, ${alpha})`
        
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        ctx.fill()
      })

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isOpen, state])

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch (e) {
        }
      }
      window.speechSynthesis.cancel()
    }
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center animate-in fade-in duration-300">
      {/* Animated particle orb */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          className="opacity-90"
        />
      </div>

      {/* Status text */}
      <div className="absolute bottom-32 left-1/2 -translate-x-1/2 text-center">
        <p className="text-teal-400 text-lg mb-8 animate-in fade-in duration-500">
          {state === 'idle' && (micPermissionDenied ? 'Microphone access denied' : 'Initializing...')}
          {state === 'listening' && 'Say something...'}
          {state === 'processing' && (sourceCount > 0 ? `Researching... (${sourceCount} sources)` : 'Processing...')}
          {state === 'speaking' && 'Speaking...'}
        </p>

        {/* Control buttons */}
        <div className="flex items-center justify-center gap-4">
          {/* Close button */}
          <button
            onClick={onClose}
            className="w-14 h-14 rounded-full bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center transition-all duration-200 active:scale-95"
            aria-label="Close voice mode"
          >
            <X className="w-6 h-6 text-neutral-300" />
          </button>

          {/* Mic toggle button - Shows current state and allows mute/unmute */}
          <button
            onClick={toggleListening}
            disabled={state === 'processing' || state === 'speaking' || micPermissionDenied}
            className={`
              w-14 h-14 rounded-full flex items-center justify-center
              transition-all duration-200 active:scale-95 relative
              ${state === 'listening'
                ? 'bg-purple-500 hover:bg-purple-600 text-white'
                : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'
              }
              ${(state === 'processing' || state === 'speaking' || micPermissionDenied) && 'opacity-50 cursor-not-allowed'}
            `}
            aria-label={state === 'listening' ? "Mute microphone" : "Unmute microphone"}
          >
            {/* Show Mic icon when listening (active), MicOff when muted */}
            {state === 'listening' ? (
              <Mic className="w-6 h-6" />
            ) : (
              <MicOff className="w-6 h-6" />
            )}
            
            {/* Pulsing ring when actively listening */}
            {state === 'listening' && (
              <span className="absolute inset-0 rounded-full border-2 border-purple-400 animate-ping opacity-75"></span>
            )}
          </button>
        </div>

        {/* Permission hint */}
        {state === 'idle' && !micPermissionDenied && (
          <p className="text-neutral-500 text-sm mt-4 animate-in fade-in duration-700">
            Click the microphone to start
          </p>
        )}
      </div>

      {/* Live transcript display */}
      {transcript && state === 'listening' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 max-w-2xl px-6 py-3 bg-neutral-900/90 rounded-lg backdrop-blur-sm border border-neutral-700 animate-in fade-in duration-200">
          <p className="text-neutral-300 text-sm italic">&ldquo;{transcript}&rdquo;</p>
        </div>
      )}
    </div>
  )
}