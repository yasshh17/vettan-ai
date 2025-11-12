"use client"

import { useEffect, useState } from "react"

interface ActiveChatTitleProps {
  title: string | null
  isVisible: boolean
}

export function ActiveChatTitle({ title, isVisible }: ActiveChatTitleProps) {
  const [displayTitle, setDisplayTitle] = useState(title)
  const [isAnimating, setIsAnimating] = useState(false)
  
  // Smooth title transition
  useEffect(() => {
    if (title !== displayTitle) {
      setIsAnimating(true)
      
      // Fade out → update → fade in
      setTimeout(() => {
        setDisplayTitle(title)
        setIsAnimating(false)
      }, 150)
    }
  }, [title, displayTitle])
  
  if (!isVisible || !displayTitle) return null
  
  return (
    <div 
      className={`
        sticky top-0 z-40
        bg-white/95 backdrop-blur-sm
        border-b border-slate-200
        px-6 py-3
        transition-all duration-300
        ${isAnimating ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}
      `}
    >
      <h2 
        className="text-xl font-semibold text-slate-900 tracking-tight truncate max-w-4xl mx-auto"
        title={displayTitle} // Full title on hover
      >
        {displayTitle}
      </h2>
    </div>
  )
}