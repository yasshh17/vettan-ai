import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const signUp = vi.fn()
const signInWithPassword = vi.fn()
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      resend: vi.fn(),
    },
  }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const toast = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }))

const signOutAndReset = vi.fn(async () => {})
vi.mock("@/lib/sign-out", () => ({ signOutAndReset: (...a: unknown[]) => signOutAndReset(...(a as [])) }))

const deleteAccount = vi.fn()
vi.mock("@/lib/api", () => ({ api: { deleteAccount: (...a: unknown[]) => deleteAccount(...a) } }))

const authGet = vi.fn()
const authPut = vi.fn()
const authPost = vi.fn()
vi.mock("@/lib/auth-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-fetch")>()),
  authGet: (...a: unknown[]) => authGet(...a),
  authPut: (...a: unknown[]) => authPut(...a),
  authPost: (...a: unknown[]) => authPost(...a),
}))

const { SignUpForm } = await import("@/components/auth/sign-up-form")
const { SignInForm } = await import("@/components/auth/sign-in-form")
const { ConsentPrompt } = await import("@/components/analytics/consent-prompt")
const { SettingsDialog } = await import("@/components/settings/settings-dialog")
const { ACCOUNT_DELETION_NOTE, WITHDRAWAL_NOTE } = await import("@/lib/analytics-consent")

const undecided = { decided: false, granted: false, erasure_pending: false, erasure_completed: false }
const granted = { ...undecided, decided: true, granted: true }
const declined = { ...undecided, decided: true }

const user = { id: "u1", email: "a@example.com", user_metadata: { full_name: "Ada" } }

function fillSignUp() {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Lovelace" } })
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-01-01" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-enough-password" } })
}

function openSettings() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<SettingsDialog open onOpenChange={vi.fn()} user={user as any} />)
}

beforeEach(() => {
  signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null })
  authGet.mockResolvedValue(granted)
  authPut.mockResolvedValue(declined)
  authPost.mockResolvedValue(declined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("sign-up", () => {
  it("starts unticked, and sign-up works without it", async () => {
    render(<SignUpForm />)
    const box = screen.getByRole("checkbox", { name: /help improve vettan/i }) as HTMLInputElement
    expect(box.checked).toBe(false)

    fillSignUp()
    fireEvent.click(screen.getByRole("button", { name: "Create account" }))

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
    expect(signUp.mock.calls[0][0].options.data.analytics_consent).toBe(false)
  })

  it("stashes a ticked box with the sign-up", async () => {
    render(<SignUpForm />)
    fireEvent.click(screen.getByRole("checkbox", { name: /help improve vettan/i }))
    fillSignUp()
    fireEvent.click(screen.getByRole("button", { name: "Create account" }))

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
    expect(signUp.mock.calls[0][0].options.data.analytics_consent).toBe(true)
  })
})

describe("sign-in", () => {
  it("explains an account that's being deleted", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "user_banned", message: "User is banned" } })
    render(<SignInForm />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-enough-password" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    expect(await screen.findByText("This account is being deleted.")).toBeTruthy()
  })
})

describe("one-time prompt", () => {
  it("asks an undecided account, with two equal choices", async () => {
    authGet.mockResolvedValue(undecided)
    render(<ConsentPrompt />)
    const yes = await screen.findByRole("button", { name: "Yes, that's fine" })
    const no = screen.getByRole("button", { name: "No thanks" })
    expect(yes.className).toBe(no.className)
  })

  it("saves the choice as a prompt decision", async () => {
    authGet.mockResolvedValue(undecided)
    render(<ConsentPrompt />)
    fireEvent.click(await screen.findByRole("button", { name: "No thanks" }))

    await waitFor(() => expect(authPut).toHaveBeenCalledTimes(1))
    expect(authPut.mock.calls[0][1]).toMatchObject({ granted: false, source: "prompt" })
  })

  it("saves nothing if it's closed without a choice", async () => {
    authGet.mockResolvedValue(undecided)
    render(<ConsentPrompt />)
    await screen.findByRole("button", { name: "No thanks" })
    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    await waitFor(() => expect(screen.queryByRole("button", { name: "No thanks" })).toBeNull())
    expect(authPut).not.toHaveBeenCalled()
  })

  it("stays out of the way once decided", async () => {
    render(<ConsentPrompt />)
    await waitFor(() => expect(authGet).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: "No thanks" })).toBeNull()
  })

  it("stays out of the way if the check fails", async () => {
    authGet.mockRejectedValue(new Error("network"))
    render(<ConsentPrompt />)
    await waitFor(() => expect(authGet).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: "No thanks" })).toBeNull()
  })

  it("shows the completion notice once, then acknowledges it", async () => {
    authGet.mockResolvedValue({ ...declined, erasure_completed: true })
    render(<ConsentPrompt />)

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0][0].description).toBe("Your linked usage history has been deleted.")
    await waitFor(() => expect(authPost).toHaveBeenCalledTimes(1))
    expect(authPost.mock.calls[0][0]).toMatch(/\/api\/analytics\/consent\/notice$/)
  })
})

describe("settings", () => {
  it("uses the required withdrawal wording", async () => {
    openSettings()
    expect(await screen.findByText(WITHDRAWAL_NOTE)).toBeTruthy()
    expect(WITHDRAWAL_NOTE).toContain("we keep linked analytics off")
    expect(WITHDRAWAL_NOTE).toContain("show a notice in Vettan the next time you use it")
    expect(WITHDRAWAL_NOTE).not.toMatch(/disabled|notify|within \d/i)
  })

  it("withdraws at once from the switch", async () => {
    openSettings()
    const toggle = await screen.findByRole("switch", { name: "Product analytics" })
    expect(toggle.getAttribute("aria-checked")).toBe("true")

    fireEvent.click(toggle)

    await waitFor(() => expect(authPut).toHaveBeenCalledTimes(1))
    expect(authPut.mock.calls[0][1]).toMatchObject({ granted: false, source: "settings" })
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"))
  })

  it("keeps the app usable and says so while an erase is pending", async () => {
    authPut.mockResolvedValue({ ...declined, erasure_pending: true })
    openSettings()
    fireEvent.click(await screen.findByRole("switch", { name: "Product analytics" }))

    expect(await screen.findByText("Product analytics is off. We're still deleting your linked usage history."))
      .toBeTruthy()
    expect(signOutAndReset).not.toHaveBeenCalled()
  })

  it("can't be turned back on while an erase is pending", async () => {
    authGet.mockResolvedValue({ ...declined, erasure_pending: true })
    openSettings()
    const toggle = await screen.findByRole("switch", { name: "Product analytics" })
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(true))
  })

  it("puts the switch back if saving fails", async () => {
    authPut.mockRejectedValue(new Error("network"))
    openSettings()
    const toggle = await screen.findByRole("switch", { name: "Product analytics" })
    fireEvent.click(toggle)

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })
})

describe("account deletion", () => {
  async function deleteIt() {
    openSettings()
    fireEvent.click(screen.getAllByRole("button", { name: "Delete account" })[0])
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } })
    const buttons = screen.getAllByRole("button", { name: /delete/i })
    fireEvent.click(buttons[buttons.length - 1])
  }

  it("describes the rules with the required wording", async () => {
    openSettings()
    expect(await screen.findByText((text) => text.includes(ACCOUNT_DELETION_NOTE))).toBeTruthy()
  })

  it("shows the required text when deletion is pending, then signs out", async () => {
    deleteAccount.mockResolvedValue({ success: true, status: "pending" })
    await deleteIt()

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast.mock.calls[0][0].description).toBe(ACCOUNT_DELETION_NOTE)
    // The redirect is a full page load, which clears the toast.
    await waitFor(() =>
      expect(signOutAndReset).toHaveBeenCalledWith({
        ignoreErrors: true,
        redirectTo: "/sign-in?error=deletion_pending",
      })
    )
  })

  it("shows the required text again on the sign-in page after that redirect", async () => {
    const { default: SignInPage } = await import("@/app/sign-in/page")
    render(await SignInPage({ searchParams: Promise.resolve({ error: "deletion_pending" }) }))

    expect(await screen.findByText(ACCOUNT_DELETION_NOTE)).toBeTruthy()
  })

  it("keeps the normal message when deletion finishes", async () => {
    deleteAccount.mockResolvedValue({ success: true, status: "deleted" })
    await deleteIt()

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast.mock.calls[0][0].title).toBe("Account deleted")
  })
})
