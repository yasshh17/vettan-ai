"use client"

import { useEffect, useState } from "react"
import {
  clearPendingQuestion,
  forgetQuestionOnThisDevice,
  readPendingQuestion,
  type PendingQuestion,
} from "@/lib/pending-question"

// Shows a question kept from the landing page while the visitor signs in or up.
// Renders nothing when there isn't one, so the auth forms are unchanged for everyone else.
export function PendingQuestionNote({ variant }: { variant: "signIn" | "signUp" | "checkEmail" }) {
  const [entry, setEntry] = useState<PendingQuestion | null>(null)

  useEffect(() => {
    // Only a question typed while signed out. One with an owner belongs to an account whose
    // session ended here; whoever is signing in now may be someone else, so it isn't shown.
    const pending = readPendingQuestion()
    setEntry(pending && !pending.owner ? pending : null)
  }, [])

  if (!entry) return null

  // On a shared device the next person shouldn't see it, as the kept copy or as a draft.
  const remove = () => {
    clearPendingQuestion(entry.id)
    if (!readPendingQuestion()) forgetQuestionOnThisDevice()
    setEntry(null)
  }

  return (
    <div className="rounded-lg border border-[#9C90FF]/30 bg-[rgba(124,111,240,0.08)] px-4 py-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-medium text-[#9B9BA8]">Your question</p>
        {variant !== "checkEmail" ? (
          <button
            type="button"
            onClick={remove}
            className="-my-2 min-h-9 text-[12.5px] font-medium text-[#9C90FF] hover:text-[#B6ACFF]"
          >
            Remove
          </button>
        ) : null}
      </div>
      <p className="mt-1 break-words text-[14px] font-medium leading-[1.45] text-[#EDEDF2]">{entry.text}</p>
      {variant === "checkEmail" ? (
        <>
          <p className="mt-2 text-[13px] leading-[1.5] text-[#9B9BA8]">
            Open the link on this device and your question will be waiting.
          </p>
          <p className="mt-1 text-[13px] leading-[1.5] text-[#9B9BA8]">
            Opening the link on another device works too, but the question field there will start empty.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[13px] leading-[1.5] text-[#9B9BA8]">
          Kept on this device while you {variant === "signUp" ? "sign up" : "sign in"}.
        </p>
      )}
    </div>
  )
}
