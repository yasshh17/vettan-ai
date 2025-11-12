"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import axios from 'axios'
import { Clock, MoreHorizontal, Star, Pencil, Trash2, SquarePen, Search, X, PanelLeft, Menu, Loader2, Check, AlertCircle } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const fetcher = (url: string) => axios.get(url).then(res => res.data)

interface Session {
  id: string
  query: string
  created_at: string
  is_favorite?: boolean
}

interface SidebarProps {
  onSelectQuery?: (query: string, sessionId?: string) => void
  isExpanded: boolean
  setIsExpanded: (expanded: boolean) => void
}

function formatTimeAgo(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    return `${Math.floor(diffInSeconds / 86400)}d ago`
  } catch {
    return 'Recently'
  }
}

const Toast = ({ message, type = 'success', onClose }: { message: string; type?: 'success' | 'error'; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div className="fixed bottom-4 right-4 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl border backdrop-blur-sm ${
        type === 'success' 
          ? 'bg-green-950/90 border-green-800 text-green-100' 
          : 'bg-red-950/90 border-red-800 text-red-100'
      }`}>
        {type === 'success' ? (
          <Check className="w-5 h-5 flex-shrink-0" />
        ) : (
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
        )}
        <p className="text-sm font-medium">{message}</p>
        <button
          onClick={onClose}
          className="ml-2 text-neutral-400 hover:text-neutral-200 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

const RenameModal = ({ 
  session, 
  isOpen, 
  onClose, 
  onConfirm, 
  isLoading 
}: { 
  session: Session
  isOpen: boolean
  onClose: () => void
  onConfirm: (newName: string) => void
  isLoading: boolean
}) => {
  const [value, setValue] = useState(session.query)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed && trimmed !== session.query) {
      onConfirm(trimmed)
    }
  }, [value, session.query, onConfirm])

  if (!isOpen) return null

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998] animate-in fade-in duration-200"
        onClick={onClose}
      />
      
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-full max-w-md px-4 animate-in fade-in duration-200">
        <div className="bg-[#1A1A1A] border border-neutral-800 rounded-xl shadow-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Pencil className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-100">Rename Conversation</h3>
              <p className="text-sm text-neutral-500">Give this chat a new name</p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="rename-input" className="block text-sm font-medium text-neutral-300 mb-2">
                Conversation Name
              </label>
              <input
                ref={inputRef}
                id="rename-input"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={isLoading}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-3 text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/30 disabled:opacity-50 transition-all"
                placeholder="Enter conversation name..."
                maxLength={200}
              />
              <p className="text-xs text-neutral-500 mt-1.5">
                {value.length}/200 characters
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium rounded-lg transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !value.trim() || value.trim() === session.query}
                className="flex-1 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

export default function Sidebar({ onSelectQuery, isExpanded, setIsExpanded }: SidebarProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [renameModalSession, setRenameModalSession] = useState<Session | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  
  const searchInputRef = useRef<HTMLInputElement>(null)
  
  const { data, error, isLoading, mutate } = useSWR(
    `${API_URL}/api/history`,
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false
    }
  )
  
  const sessions: Session[] = data?.sessions || []
  
  const { favoriteSessions, recentSessions } = useMemo(() => {
    const filtered = searchQuery
      ? sessions.filter(session => 
          session.query.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : sessions

    const favorites = filtered.filter(s => s.is_favorite)
    const recents = filtered.filter(s => !s.is_favorite)

    return { favoriteSessions: favorites, recentSessions: recents }
  }, [sessions, searchQuery])
  
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
  }, [])
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      
      const isDropdownClick = Array.from(document.querySelectorAll('[role="menu"]')).some(
        (dropdown) => dropdown.contains(target)
      )
      
      const isToggleButton = (event.target as HTMLElement).closest('[aria-label="Chat actions"]')
      
      if (!isDropdownClick && !isToggleButton) {
        setDropdownOpen(null)
      }
    }
    
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])
  
  useEffect(() => {
    if (isSearchOpen && searchInputRef.current && isExpanded) {
      searchInputRef.current.focus()
    }
  }, [isSearchOpen, isExpanded])
  
  const handleHistoryClick = useCallback((session: Session) => {
    setActiveSessionId(session.id)
    setIsMobileOpen(false)
    onSelectQuery?.(session.query, session.id)
  }, [onSelectQuery])
  
  const handleNewChat = useCallback(() => {
    setActiveSessionId(null)
    setSearchQuery('')
    setIsSearchOpen(false)
    setHoveredSessionId(null)
    setIsMobileOpen(false)
    onSelectQuery?.('', undefined)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [onSelectQuery])
  
  const toggleSearch = useCallback(() => {
    if (!isExpanded) {
      setIsExpanded(true)
      setTimeout(() => setIsSearchOpen(true), 300)
    } else {
      setIsSearchOpen(!isSearchOpen)
      if (isSearchOpen) {
        setSearchQuery('')
      }
    }
  }, [isExpanded, isSearchOpen, setIsExpanded])
  
  const toggleDropdown = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDropdownOpen(dropdownOpen === sessionId ? null : sessionId)
  }, [dropdownOpen])
  
  const handleFavorite = useCallback(async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    
    const newFavoriteStatus = !session.is_favorite
    const actionKey = `favorite-${session.id}`
    
    setDropdownOpen(null)
    setLoadingAction(actionKey)
    
    mutate(
      (currentData: any) => {
        if (!currentData?.sessions) return currentData
        return {
          ...currentData,
          sessions: currentData.sessions.map((s: Session) =>
            s.id === session.id ? { ...s, is_favorite: newFavoriteStatus } : s
          )
        }
      },
      false
    )
    
    try {
      await axios.patch(`${API_URL}/api/history/${session.id}`, {
        is_favorite: newFavoriteStatus
      })
      
      showToast(
        newFavoriteStatus ? "Added to favorites" : "Removed from favorites",
        'success'
      )
      
      mutate()
    } catch (error: any) {
      console.error('Failed to toggle favorite:', error)
      mutate()
      showToast('Failed to update favorite', 'error')
    } finally {
      setLoadingAction(null)
    }
  }, [mutate, showToast])
  
  const handleRenameInit = useCallback((session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    setDropdownOpen(null)
    setRenameModalSession(session)
  }, [])

  const handleRenameConfirm = useCallback(async (newTitle: string) => {
    if (!renameModalSession) return
    
    const actionKey = `rename-${renameModalSession.id}`
    setLoadingAction(actionKey)
    
    mutate(
      (currentData: any) => {
        if (!currentData?.sessions) return currentData
        return {
          ...currentData,
          sessions: currentData.sessions.map((s: Session) =>
            s.id === renameModalSession.id ? { ...s, query: newTitle } : s
          )
        }
      },
      false
    )
    
    try {
      await axios.patch(`${API_URL}/api/history/${renameModalSession.id}`, {
        query: newTitle
      })
      
      showToast('Conversation renamed', 'success')
      setRenameModalSession(null)
      mutate()
    } catch (error: any) {
      console.error('Failed to rename:', error)
      mutate()
      showToast('Failed to rename conversation', 'error')
    } finally {
      setLoadingAction(null)
    }
  }, [renameModalSession, mutate, showToast])

  const handleRenameCancel = useCallback(() => {
    setRenameModalSession(null)
  }, [])
  
  const handleDeleteInit = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDropdownOpen(null)
    setDeleteConfirmOpen(sessionId)
  }, [])

  const handleDeleteConfirm = useCallback(async (sessionId: string) => {
    const actionKey = `delete-${sessionId}`
    setLoadingAction(actionKey)
    setDeleteConfirmOpen(null)
    
    mutate(
      (currentData: any) => {
        if (!currentData?.sessions) return currentData
        return {
          ...currentData,
          sessions: currentData.sessions.filter((s: Session) => s.id !== sessionId)
        }
      },
      false
    )
    
    try {
      await axios.delete(`${API_URL}/api/history/${sessionId}`)
      
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        onSelectQuery?.('', undefined)
      }
      
      showToast('Conversation deleted', 'success')
      mutate()
    } catch (error: any) {
      console.error('Failed to delete:', error)
      mutate()
      showToast('Failed to delete conversation', 'error')
    } finally {
      setLoadingAction(null)
    }
  }, [activeSessionId, mutate, onSelectQuery, showToast])

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirmOpen(null)
  }, [])

  const SessionItem = useCallback(({ session, isFavorite }: { session: Session; isFavorite?: boolean }) => {
    const isActive = activeSessionId === session.id
    const isDropdownOpenForThis = dropdownOpen === session.id
    const isHovered = hoveredSessionId === session.id
    const isDeleting = deleteConfirmOpen === session.id
    const isActionLoading = loadingAction?.includes(session.id)
    
    if (isDeleting) {
      return (
        <div className="relative p-3 rounded-lg bg-red-950/20 border border-red-900/50 animate-in fade-in duration-200">
          <div className="text-sm text-red-300 mb-3 font-medium">
            Delete this conversation?
          </div>
          <div className="text-xs text-red-400/80 mb-3 line-clamp-1">
            {session.query}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteConfirm(session.id)
              }}
              disabled={isActionLoading}
              className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isActionLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                'Delete'
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteCancel()
              }}
              disabled={isActionLoading}
              className="flex-1 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium rounded-lg transition-all disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )
    }
    
    return (
      <div 
        className="relative"
        onMouseEnter={() => setHoveredSessionId(session.id)}
        onMouseLeave={() => setHoveredSessionId(null)}
      >
        <div 
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (!target.closest('[aria-label="Chat actions"]') && !target.closest('[role="menu"]')) {
              handleHistoryClick(session)
            }
          }}
          className={`relative w-full text-left p-3 pr-12 rounded-lg transition-all duration-200 cursor-pointer ${isActive ? 'bg-neutral-800 text-neutral-100 font-medium' : 'bg-neutral-800/40 hover:bg-neutral-800/70 text-neutral-400'}`}
        >
          <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
            <Clock className="h-3 w-3 flex-shrink-0" />
            <span>{formatTimeAgo(session.created_at)}</span>
          </div>
          <div className={`text-sm line-clamp-2 transition-colors ${isFavorite ? 'flex items-center gap-1.5' : ''} ${isActive ? 'text-neutral-100' : isHovered ? 'text-neutral-200' : 'text-neutral-400'}`}>
            {isFavorite && <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500 flex-shrink-0" />}
            <span className="truncate">{session.query}</span>
          </div>
          
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              toggleDropdown(session.id, e)
            }}
            disabled={isActionLoading}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-md flex items-center justify-center transition-all duration-200 z-20 text-neutral-400 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              opacity: isDropdownOpenForThis || isHovered || isActionLoading ? 1 : 0,
              backgroundColor: isDropdownOpenForThis ? 'rgb(64 64 64)' : undefined
            }}
            aria-label="Chat actions"
          >
            {isActionLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <MoreHorizontal className="w-4 h-4" />
            )}
          </button>
        </div>
        
        {isDropdownOpenForThis && (
            <div 
              role="menu" 
              className="absolute right-2 top-full mt-1 w-48 bg-neutral-900 border border-neutral-700 rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.6)] py-1 z-[100] animate-in fade-in slide-in-from-top-2 duration-200" 
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
            <button 
              type="button"
              onClick={(e) => handleFavorite(session, e)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-[#E5E5E5] text-sm hover:bg-[#333333] transition-colors text-left" 
              role="menuitem"
            >
              <Star className="w-5 h-5 flex-shrink-0" fill={session.is_favorite ? "currentColor" : "none"} />
              <span>{session.is_favorite ? 'Unfavorite' : 'Favorite'}</span>
            </button>
            <button 
              type="button"
              onClick={(e) => handleRenameInit(session, e)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-[#E5E5E5] text-sm hover:bg-[#333333] transition-colors text-left" 
              role="menuitem"
            >
              <Pencil className="w-5 h-5 flex-shrink-0" />
              <span>Rename</span>
            </button>
            <div className="h-px bg-[#3A3A3A] my-1" />
            <button 
              type="button"
              onClick={(e) => handleDeleteInit(session.id, e)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-red-400 text-sm hover:bg-[#333333] transition-colors text-left" 
              role="menuitem"
            >
              <Trash2 className="w-5 h-5 flex-shrink-0" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    )
  }, [activeSessionId, dropdownOpen, hoveredSessionId, deleteConfirmOpen, loadingAction, handleHistoryClick, toggleDropdown, handleFavorite, handleRenameInit, handleDeleteInit, handleDeleteConfirm, handleDeleteCancel])

  const SidebarContent = () => (
    <>
      <div className="p-2 border-b border-neutral-800/50 flex-shrink-0">
        <div className={`flex items-center mb-2 ${isExpanded ? 'justify-between' : 'justify-center'}`}>
          <button
            onClick={() => {
              setIsExpanded(!isExpanded)
              if (!isExpanded) setIsMobileOpen(false)
            }}
            className="w-10 h-10 rounded-lg hover:bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-neutral-200 transition-all duration-200 lg:flex hidden"
            aria-label={isExpanded ? 'Close sidebar' : 'Open sidebar'}
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          
          <button
            onClick={() => setIsMobileOpen(false)}
            className="lg:hidden w-10 h-10 rounded-lg hover:bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-neutral-200 transition-all duration-200"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
          
          {isExpanded && (
            <div className="flex-1 ml-2 overflow-hidden">
              <button
                onClick={handleNewChat}
                className="text-sm font-semibold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent hover:opacity-80 transition-opacity duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-neutral-900 rounded px-1"
                aria-label="Return to homepage"
              >
                Vettan
              </button>
            </div>
          )}
        </div>

        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-neutral-200 text-sm font-medium hover:bg-neutral-800 transition-all duration-200"
          aria-label="Start new chat"
        >
          <SquarePen className="w-5 h-5 flex-shrink-0" />
          {isExpanded && <span className="flex-1 text-left truncate">New chat</span>}
        </button>
        
        <button
          onClick={toggleSearch}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-neutral-200 text-sm hover:bg-neutral-800 transition-all duration-200 mt-1"
          aria-label="Search chats"
        >
          <Search className="w-5 h-5 flex-shrink-0" />
          {isExpanded && <span className="flex-1 text-left truncate">Search chats</span>}
        </button>
        
        {isSearchOpen && isExpanded && (
          <div className="mt-2 px-1 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-3 pr-8 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-all duration-200"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-200 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            
            {searchQuery && (
              <p className="text-neutral-500 text-xs mt-1.5 px-1">
                {favoriteSessions.length + recentSessions.length} result{(favoriteSessions.length + recentSessions.length) !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
      </div>
      
      {isExpanded && (
        <div className="flex-1 overflow-y-auto overflow-x-visible">
          <div className="p-3">
            
            {favoriteSessions.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">Favorites</h2>
                  <span className="text-neutral-600 text-xs">({favoriteSessions.length})</span>
                </div>

                <div className="space-y-1">
                  {favoriteSessions.map((session) => (
                    <SessionItem key={session.id} session={session} isFavorite />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 mb-2 px-1">
                <Clock className="w-4 h-4 text-neutral-500" />
                <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold">
                  {favoriteSessions.length > 0 ? 'Recents' : 'History'}
                </h2>
                {recentSessions.length > 0 && <span className="text-neutral-600 text-xs">({recentSessions.length})</span>}
              </div>

              <div className="space-y-1">
                {recentSessions.map((session) => (
                  <SessionItem key={session.id} session={session} />
                ))}
                
                {recentSessions.length === 0 && !isLoading && (
                  <div className="text-center py-8 px-4">
                    {searchQuery ? (
                      <>
                        <Search className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
                        <p className="text-neutral-500 text-sm">No chats found</p>
                      </>
                    ) : favoriteSessions.length > 0 ? (
                      <p className="text-neutral-600 text-xs py-4">All chats are in Favorites</p>
                    ) : (
                      <>
                        <Clock className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
                        <p className="text-neutral-500 text-sm mb-1">No history yet</p>
                        <p className="text-neutral-600 text-xs">Start a research query</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  )
  
  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {renameModalSession && (
        <RenameModal
          session={renameModalSession}
          isOpen={!!renameModalSession}
          onClose={handleRenameCancel}
          onConfirm={handleRenameConfirm}
          isLoading={!!loadingAction?.includes('rename')}
        />
      )}

      <button
        onClick={() => setIsMobileOpen(true)}
        className="mobile-menu-button lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="w-6 h-6" />
      </button>

      <div
        className={`sidebar-backdrop ${isMobileOpen ? 'active' : ''}`}
        onClick={() => setIsMobileOpen(false)}
      />

      <aside 
        className={`fixed left-0 top-0 h-screen z-50 bg-neutral-900 border-r border-neutral-800 hidden lg:flex flex-col transition-all duration-300 ease-out ${isExpanded ? 'w-64' : 'w-16'}`}
      >
        <SidebarContent />
      </aside>

      <aside 
        className={`fixed left-0 top-0 h-screen z-[1000] bg-neutral-900 border-r border-neutral-800 flex lg:hidden flex-col w-64 transition-transform duration-300 ease-out ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SidebarContent />
      </aside>
    </>
  )
}