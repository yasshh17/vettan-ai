"use client"

import { useEffect, useState } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import { API_BASE_URL, authPut } from "@/lib/auth-fetch"

export type Rating = "up" | "down"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface AnswerFeedbackProps {
  sessionId: string | null
  messageId: string
  initialRating?: Rating | null
  isFollowup?: boolean
}

export function AnswerFeedback({
  sessionId,
  messageId,
  initialRating = null,
  isFollowup = false
}: AnswerFeedbackProps) {
  const [rating, setRating] = useState<Rating | null>(initialRating)
  const [saving, setSaving] = useState(false)

  // Saved votes arrive after the messages render.
  useEffect(() => setRating(initialRating), [initialRating])

  // No vote without a saved session and message.
  if (!sessionId || !UUID.test(sessionId) || !UUID.test(messageId)) return null

  const vote = async (choice: Rating) => {
    if (saving) return
    const previous = rating
    const next = previous === choice ? null : choice
    setRating(next)
    setSaving(true)
    try {
      await authPut(`${API_BASE_URL}/api/feedback`, {
        session_id: sessionId,
        message_id: messageId,
        rating: next,
        is_followup: isFollowup
      })
    } catch {
      setRating(previous)
    } finally {
      setSaving(false)
    }
  }

  const buttonClass = (active: boolean, activeColor: string) =>
    `p-1.5 rounded-lg transition-colors duration-150 hover:bg-neutral-800 disabled:opacity-60 ${
      active ? activeColor : "text-gray-500 hover:text-gray-300"
    }`

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => vote("up")}
        disabled={saving}
        aria-label="Good answer"
        aria-pressed={rating === "up"}
        className={buttonClass(rating === "up", "text-purple-400")}
      >
        <ThumbsUp className="w-4 h-4" fill={rating === "up" ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        onClick={() => vote("down")}
        disabled={saving}
        aria-label="Bad answer"
        aria-pressed={rating === "down"}
        className={buttonClass(rating === "down", "text-purple-400")}
      >
        <ThumbsDown className="w-4 h-4" fill={rating === "down" ? "currentColor" : "none"} />
      </button>
    </div>
  )
}
