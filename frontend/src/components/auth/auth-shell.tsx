import Link from "next/link"
import { AuthBackground } from "@/components/auth/auth-background"

interface AuthShellProps {
  mode: "sign-in" | "sign-up"
  title: string
  subtitle: string
  children: React.ReactNode
}

const switchCopy = {
  "sign-in": { text: "Don't have an account?", label: "Sign up", href: "/sign-up" },
  "sign-up": { text: "Already have an account?", label: "Sign in", href: "/sign-in" },
}

export function AuthShell({ mode, title, subtitle, children }: AuthShellProps) {
  const swap = switchCopy[mode]

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#09090c] text-[#EDEDF2]">
      <AuthBackground />

      <nav className="relative z-10 flex items-center justify-between px-12 py-6">
        <Link
          href="/"
          className="text-[19px] font-bold tracking-[-0.01em] text-[#EDEDF2]"
        >
          Vettan
        </Link>
        <p className="text-[14px] text-[#9B9BA8]">
          {swap.text}{" "}
          <Link href={swap.href} className="font-medium text-[#9C90FF] hover:text-[#B6ACFF]">
            {swap.label}
          </Link>
        </p>
      </nav>

      <main className="relative z-10 flex flex-col items-center px-6 pb-24 pt-[8vh]">
        <h1 className="text-center text-[40px] font-bold tracking-[-0.02em] text-[#EDEDF2]">
          {title}
        </h1>
        <p className="mt-3 text-center text-[16px] text-[#9B9BA8]">{subtitle}</p>
        <div className="mt-10 w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  )
}
