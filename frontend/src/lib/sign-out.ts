import { mutate } from "swr"
import { createClient } from "@/lib/supabase/client"

/**
 * Sign out, clear the SWR cache and do a full page load, so nothing from this account
 * survives into the next sign-in.
 *
 * @param ignoreErrors  continue if the server sign-out fails (e.g. after account deletion).
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

  // Drop every key without refetching.
  await mutate(() => true, undefined, { revalidate: false })

  window.location.assign(redirectTo)
}
