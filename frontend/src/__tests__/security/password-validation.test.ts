import { describe, expect, it } from "vitest"
import { validatePassword, validateSignInPassword } from "@/components/auth/validation"

describe("password rules", () => {
  it("requires at least 8 characters for a new password", () => {
    expect(validatePassword("1234567")).not.toBeNull()
    expect(validatePassword("12345678")).toBeNull()
  })

  it("lets existing accounts with older 6-character passwords sign in", () => {
    expect(validateSignInPassword("123456")).toBeNull()
    expect(validateSignInPassword("")).not.toBeNull()
  })
})
