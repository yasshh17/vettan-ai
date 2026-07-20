export function BackgroundLayer() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="animate-drift-a absolute -left-[10%] -top-[10%] h-[520px] w-[520px] rounded-full blur-[80px]"
        style={{ background: "radial-gradient(circle, rgba(124,111,240,0.16), transparent 70%)" }}
      />
      <div
        className="animate-drift-b absolute right-[-5%] top-[30%] h-[440px] w-[440px] rounded-full blur-[80px]"
        style={{ background: "radial-gradient(circle, rgba(124,111,240,0.08), transparent 70%)" }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 45%, transparent 85%)",
          WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 45%, transparent 85%)",
        }}
      />
    </div>
  )
}
