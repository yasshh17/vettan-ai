import { cn } from "@/lib/utils"

interface AuthFieldProps extends React.ComponentProps<"input"> {
  label: string
  error?: string | null
  rightSlot?: React.ReactNode
}

export function AuthField({ label, error, rightSlot, id, className, ...props }: AuthFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-[14px] font-medium text-[#EDEDF2]">
          {label}
        </label>
        {rightSlot}
      </div>
      <input
        id={id}
        className={cn(
          "h-12 rounded-xl border bg-[rgba(255,255,255,0.02)] px-4 text-[15px] text-[#EDEDF2] outline-none transition-colors placeholder:text-[#6B6B78] focus:border-[#7C6FF0] focus:bg-[rgba(124,111,240,0.06)]",
          error ? "border-[#f87171]/60" : "border-[rgba(255,255,255,0.08)]",
          className
        )}
        aria-invalid={!!error}
        {...props}
      />
      {error && <p className="text-[13px] text-[#f87171]">{error}</p>}
    </div>
  )
}
