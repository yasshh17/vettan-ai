import { mutate } from "swr"
import { createClient } from "@/lib/supabase/client"

/**
 * End the session and leave nothing of the previous account behind in this tab.
 *
 * Sign-out used to be `signOut()` followed by a soft `router.push`, which keeps
 * the whole JS heap alive: SWR's module-level cache (history lists, fetched
 * sessions) and any React state survive into whoever signs in next. Isolation
 * then rested on a single line of defense, the user id inside the history cache
 * key. This removes the class of problem instead of relying on that key:
 *
 *  1. sign the session out,
 *  2. empty the SWR cache, and
 *  3. navigate with a full page load, which discards all in-memory state
 *     (same reasoning as `redirectToSignIn` in auth-fetch.ts).
 *
 * @param ignoreErrors  keep going if the server-side sign-out fails. Used after
 *   account deletion, where the auth user no longer exists so that call may be
 *   rejected even though the local session should still be dropped.
 */
export async function signOutAndReset(
  options: { redirectTo?: string; ignoreErrors?: boolean } = {}
): Promise<void> {
  const { redirectTo = "/sign-in", ignoreErrors = false } = options

  try {
    await createClient().auth.signOut()
  } catch (err) {
    if (!ignoreErrors) throw err
  }

  // Match every key and drop its data without refetching: there is no user left
  // to fetch it for.
  await mutate(() => true, undefined, { revalidate: false })

  window.location.assign(redirectTo)
}
