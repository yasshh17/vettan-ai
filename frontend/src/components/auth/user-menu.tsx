"use client"

import { useEffect, useState } from "react"
import { ChevronsUpDown, Loader2, LogOut, Settings } from "lucide-react"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { signOutAndReset } from "@/lib/sign-out"
import { initials } from "@/lib/utils"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function UserMenu({ isExpanded }: { isExpanded: boolean }) {
  const [user, setUser] = useState<User | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUser(data.user)).catch(() => {})
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!user) return null

  const name = (user.user_metadata?.full_name as string) || user.email || "Account"
  const email = user.email ?? ""

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      // Clears the SWR cache and does a full page load, so nothing from this
      // account is left in memory for the next one. Leaves the button in its
      // "signing out" state on success: the page is about to be replaced.
      await signOutAndReset()
    } catch {
      setSigningOut(false)
    }
  }

  const avatar = (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-semibold text-white">
      {initials(name)}
    </div>
  )

  return (
    <>
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setConfirming(false)
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          className={`flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-neutral-800 ${
            isExpanded ? "" : "justify-center"
          }`}
        >
          {avatar}
          {isExpanded && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-100">{name}</p>
                <p className="truncate text-xs text-neutral-500">{email}</p>
              </div>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-neutral-500" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 border-neutral-800 bg-neutral-900 text-neutral-200"
      >
        {confirming ? (
          <div className="p-1">
            <p className="px-2 py-1.5 text-sm font-medium text-neutral-100">Sign out of Vettan?</p>
            <p className="px-2 pb-2 text-xs text-neutral-500">
              You&apos;ll need to sign in again to continue.
            </p>
            <div className="flex gap-2 px-1 pb-1">
              <button
                onClick={() => setConfirming(false)}
                disabled={signingOut}
                className="flex-1 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:bg-neutral-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {signingOut && <Loader2 className="h-4 w-4 animate-spin" />}
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-2 py-2">
              <p className="truncate text-sm font-medium text-neutral-100">{name}</p>
              <p className="truncate text-xs text-neutral-500">{email}</p>
            </div>
            <DropdownMenuSeparator className="bg-neutral-800" />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setOpen(false)
                setTimeout(() => setSettingsOpen(true), 0)
              }}
              className="focus:bg-neutral-800 focus:text-neutral-100"
            >
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setConfirming(true)
              }}
              className="text-neutral-200 focus:bg-neutral-800 focus:text-neutral-100"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} user={user} />
    </>
  )
}
