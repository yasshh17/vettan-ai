"use client"

import { useState } from "react"
import { ChevronDown, FileText, ExternalLink } from "lucide-react"

interface Source {
  domain: string
  url: string
}

interface CollapsibleSourcesProps {
  sources: Source[]
}

export function CollapsibleSources({ sources }: CollapsibleSourcesProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!sources || sources.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="group w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-purple-500/8 border border-purple-500/30 hover:bg-purple-500/12 hover:border-purple-500/40 hover:shadow-[0_0_16px_rgba(139,92,246,0.15)] active:scale-[0.98] transition-all duration-200"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse sources" : "Expand sources"}
      >
        <ChevronDown
          className={`w-4 h-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${
            isExpanded ? "rotate-180" : ""
          }`}
        />

        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          <FileText className="w-5 h-5 text-purple-400" strokeWidth={2} />
        </div>

        <div className="flex items-center gap-2 flex-1">
          <span className="text-[15px] font-semibold text-gray-200">
            Sources
          </span>
          <span className="text-sm text-gray-400 font-medium">
            ({sources.length})
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-purple-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <span>{isExpanded ? "Collapse" : "View all"}</span>
        </div>
      </button>

      {/* Expanded List */}
      {isExpanded && (
        <div
          className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300"
          role="region"
          aria-label="Source citations"
        >
          {sources.map((source, index) => (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-neutral-900/50 border border-neutral-800 hover:bg-neutral-900 hover:border-neutral-700 hover:shadow-sm active:scale-[0.98] transition-all duration-200 animate-in fade-in slide-in-from-top-2"
              style={{ animationDelay: `${index * 30}ms` }}
              aria-label={`Open source ${index + 1}: ${source.domain}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-purple-500/10 text-purple-400 text-xs font-semibold">
                  {index + 1}
                </span>

                <span className="text-sm text-gray-300 truncate group-hover:text-gray-100 transition-colors font-medium">
                  {source.domain}
                </span>
              </div>

              <div className="flex items-center gap-2 text-purple-300 group-hover:text-purple-200 group-hover:translate-x-1 transition-all duration-200 flex-shrink-0">
              <span className="text-xs font-medium">Open</span>
              <ExternalLink className="w-4 h-4" strokeWidth={2} />
            </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
