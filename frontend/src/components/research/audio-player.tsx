"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Volume2, Download, Loader2, Play, Pause, RotateCcw, Sparkles, X } from "lucide-react"
import axios from "axios"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"

const VOICES = {
  nova: "Female, warm, friendly",
  alloy: "Neutral, balanced",
  echo: "Male, clear",
  fable: "British, expressive",
  onyx: "Deep, authoritative",
  shimmer: "Female, energetic"
}

interface AudioPlayerProps {
  text: string
}

export function AudioPlayer({ text }: AudioPlayerProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState("nova")
  const [cost, setCost] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [showNotification, setShowNotification] = useState(false)
  
  const audioRef = useRef<HTMLAudioElement | null>(null)
  
  useEffect(() => {
    if (audioUrl && !audioRef.current) {
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      
      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration)
        setIsReady(true)
      })
      
      audio.addEventListener('timeupdate', () => {
        setCurrentTime(audio.currentTime)
        setProgress((audio.currentTime / audio.duration) * 100)
      })
      
      audio.addEventListener('ended', () => {
        setIsPlaying(false)
        setProgress(0)
        setCurrentTime(0)
      })
      
      audio.addEventListener('play', () => setIsPlaying(true))
      audio.addEventListener('pause', () => setIsPlaying(false))
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [audioUrl])
  
  // Show notification when audio is ready
  useEffect(() => {
    if (isReady) {
      setShowNotification(true)
      
      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        setShowNotification(false)
      }, 5000)
      
      return () => clearTimeout(timer)
    }
  }, [isReady])
  
  const handleGenerate = async () => {
    setIsGenerating(true)
    setIsReady(false)
    
    try {
      const response = await axios.post(`${API_URL}/api/audio`, {
        text,
        voice: selectedVoice
      })
      
      const audioData = atob(response.data.audio)
      const audioArray = new Uint8Array(audioData.length)
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i)
      }
      const audioBlob = new Blob([audioArray], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(audioBlob)
      
      setAudioUrl(url)
      setCost(response.data.cost)
      
    } catch (error) {
      console.error('Audio generation failed:', error)
    } finally {
      setIsGenerating(false)
    }
  }
  
  const togglePlayPause = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
  }
  
  const handleRestart = () => {
    if (!audioRef.current) return
    audioRef.current.currentTime = 0
    audioRef.current.play()
  }
  
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return
    const bounds = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - bounds.left
    const percentage = x / bounds.width
    audioRef.current.currentTime = percentage * audioRef.current.duration
  }
  
  const handleDownload = () => {
    if (!audioUrl) return
    const a = document.createElement('a')
    a.href = audioUrl
    a.download = `vettan-report-${Date.now()}.mp3`
    a.click()
  }
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  const handleReset = () => {
    setAudioUrl(null)
    setIsPlaying(false)
    setProgress(0)
    setCurrentTime(0)
    setDuration(0)
    setIsReady(false)
    setShowNotification(false)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }
  
  return (
    <>
      {/* Premium Toast Notification - Top Right */}
      {showNotification && (
        <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
          <div className="bg-gradient-to-br from-purple-500/20 to-indigo-500/20 backdrop-blur-xl border-2 border-purple-500/40 rounded-2xl shadow-[0_8px_32px_rgba(139,92,246,0.3)] p-4 pr-12 max-w-sm">
            {/* Close button */}
            <button
              onClick={() => setShowNotification(false)}
              className="absolute top-3 right-3 w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4 text-neutral-300" />
            </button>

            {/* Content */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                <Volume2 className="w-5 h-5 text-white" />
              </div>
              
              <div className="flex-1 pt-0.5">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-white font-semibold text-sm">Audio Ready</h4>
                  <Sparkles className="w-4 h-4 text-purple-400" />
                </div>
                <p className="text-neutral-300 text-xs leading-relaxed">
                  Your report in <span className="text-purple-300 font-medium">{selectedVoice.charAt(0).toUpperCase() + selectedVoice.slice(1)} voice</span> is ready. Click play to listen.
                </p>
              </div>
            </div>

            {/* Progress bar - auto-dismiss indicator */}
            <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-[5000ms] ease-linear"
                style={{ width: showNotification ? '0%' : '100%' }}
              ></div>
            </div>
          </div>
        </div>
      )}

      <Card className="shadow-lg border-neutral-800 bg-neutral-900 overflow-hidden">
        <CardHeader className="border-b border-neutral-800 bg-neutral-900">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg text-neutral-100">
              <Volume2 className="h-5 w-5 text-purple-400" />
              Audio Version
            </CardTitle>
            
            {/* Integrated success badge */}
            {isReady && (
              <span className="px-3 py-1 bg-green-500/20 border border-green-500/30 rounded-full text-green-400 text-xs font-medium flex items-center gap-1.5 animate-in fade-in duration-300">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                Ready
              </span>
            )}
          </div>
        </CardHeader>
        
        <CardContent className="p-6 space-y-5 bg-neutral-900">
          {!audioUrl ? (
            <>
              <div>
                <label className="text-sm font-medium text-neutral-300 mb-2 block">
                  Select Voice
                </label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="w-full p-3 bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all cursor-pointer"
                  disabled={isGenerating}
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23a0a0a0' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.75rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.5em 1.5em',
                    paddingRight: '2.5rem',
                    appearance: 'none',
                  }}
                >
                  {Object.entries(VOICES).map(([key, desc]) => (
                    <option key={key} value={key} className="bg-neutral-800 text-neutral-200">
                      {key.charAt(0).toUpperCase() + key.slice(1)} — {desc}
                    </option>
                  ))}
                </select>
              </div>
              
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-transparent border-2 border-purple-500/50 text-purple-400 hover:bg-purple-500/10 hover:border-purple-400 active:scale-[0.98] font-medium text-base rounded-lg shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Generating Audio...</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="h-5 w-5" />
                    <span>Generate Audio</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="bg-neutral-800 rounded-xl p-5 space-y-4">
                <div 
                  className="h-2 bg-neutral-700 rounded-full cursor-pointer overflow-hidden group"
                  onClick={handleProgressClick}
                >
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                
                <div className="flex justify-between text-xs text-neutral-400 font-medium">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                
                <div className="flex items-center gap-3">
                  <Button
                    onClick={togglePlayPause}
                    size="lg"
                    className="flex-shrink-0 h-12 w-12 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105 active:scale-95 transition-all"
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                  </Button>
                  
                  {isReady && !isPlaying && progress === 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-green-400 font-medium animate-in fade-in duration-300">
                      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                      Ready to play
                    </div>
                  )}
                  
                  <Button onClick={handleRestart} variant="outline" size="lg" className="h-12 px-4 border-neutral-700 text-neutral-300 hover:bg-neutral-700 transition-colors">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  
                  <div className="flex-1 px-3 py-2.5 bg-neutral-700 rounded-lg border border-neutral-600">
                    <span className="text-sm font-medium text-neutral-200">
                      {selectedVoice.charAt(0).toUpperCase() + selectedVoice.slice(1)}
                    </span>
                  </div>
                  
                  <Button onClick={handleDownload} variant="outline" size="lg" className="h-12 px-4 border-neutral-700 text-neutral-300 hover:bg-neutral-700 transition-colors">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center justify-end pt-3 border-t border-neutral-800">
                <Button onClick={handleReset} variant="ghost" size="sm" className="text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-colors">
                  Generate with different voice
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}