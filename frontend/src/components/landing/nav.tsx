import Link from "next/link"

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between border-b border-[rgba(255,255,255,0.07)] bg-[rgba(9,9,12,0.7)] px-12 py-5 backdrop-blur-[12px]">
      <Link
        href="/"
        className="text-[19px] font-bold tracking-[-0.01em] text-[#EDEDF2]"
      >
        Vettan
      </Link>
      <Link
        href="/sign-in"
        className="text-[14px] font-medium text-[#9B9BA8] transition-colors hover:text-[#EDEDF2]"
      >
        Sign in
      </Link>
    </nav>
  )
}
