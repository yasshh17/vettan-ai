"use client"

import { Printer } from "lucide-react"

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mt-3.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-white/10 text-[13.5px] font-medium text-[#C4C4CE] transition-colors hover:bg-white/[0.06] hover:text-[#EDEDF2]"
    >
      <Printer className="h-[15px] w-[15px]" aria-hidden="true" />
      Print or save as PDF
    </button>
  )
}
