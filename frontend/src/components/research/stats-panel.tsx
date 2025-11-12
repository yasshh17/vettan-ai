"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface StatsPanelProps {
  metadata: {
    iterations: number
    estimated_cost: number
    from_cache: boolean
  }
  citationsCount: number
}

export function StatsPanel({ metadata, citationsCount }: StatsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault()
        setShowAdvanced(prev => !prev)
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showAdvanced])
  
  if (!showAdvanced) return null
  
  return (
    <Card className="shadow-lg border-yellow-200 dark:border-yellow-900/50 bg-yellow-50 dark:bg-yellow-950/20 animate-in slide-in-from-right-2 duration-300">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between text-slate-900 dark:text-dark-text-primary">
          <span>🔧 Developer Info</span>
          <button
            onClick={() => setShowAdvanced(false)}
            className="text-xs text-slate-500 dark:text-dark-text-tertiary hover:text-slate-700 dark:hover:text-dark-text-secondary transition-colors"
            aria-label="Hide debug info"
          >
            Hide
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="text-xs text-slate-500 dark:text-dark-text-tertiary">Steps</div>
          <div className="text-2xl font-bold text-indigo-600 dark:text-purple-400">
            {metadata.iterations}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-dark-text-tertiary">Sources</div>
          <div className="text-2xl font-bold text-indigo-600 dark:text-purple-400">
            {citationsCount}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-dark-text-tertiary">Cost</div>
          <div className="text-2xl font-bold text-indigo-600 dark:text-purple-400">
            ${metadata.estimated_cost.toFixed(4)}
          </div>
        </div>
        {metadata.from_cache && (
          <div className="pt-2 border-t border-slate-200 dark:border-dark-border-default">
            <div className="text-xs text-green-600 dark:text-green-400 font-medium">
              ✓ Served from cache
            </div>
          </div>
        )}
        <div className="pt-2 border-t border-slate-200 dark:border-dark-border-default text-xs text-slate-400 dark:text-dark-text-tertiary">
          Press ⌘⇧D to toggle
        </div>
      </CardContent>
    </Card>
  )
}