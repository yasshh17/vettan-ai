import Link from "next/link"
import { Reveal } from "./reveal"

export function ClosingCta() {
  return (
    <Reveal className="relative z-10 mx-auto max-w-[720px] px-12 py-[110px] text-center">
      <h2 className="text-[34px] font-bold tracking-[-0.01em] text-[#EDEDF2]">
        Stop reading ten tabs.
      </h2>
      <p className="mx-auto mt-4 max-w-[480px] text-[17px] leading-[1.55] text-[#A6A6B3]">
        Ask Vettan something you actually need answered.
      </p>
      <div className="mt-8 flex justify-center">
        <Link
          href="/sign-up"
          className="rounded-[10px] bg-[#9C90FF] px-6 py-3 text-[14px] font-semibold text-[#0B0B10] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(124,111,240,0.4)]"
        >
          Try Vettan
        </Link>
      </div>
    </Reveal>
  )
}
