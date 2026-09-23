export function AuthBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="animate-auth-dots absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        className="animate-auth-rise absolute h-[1050px] w-[1400px]"
        style={{
          bottom: "-25%",
          left: "50%",
          background:
            "radial-gradient(ellipse at center, rgba(124,111,240,0.38), transparent 65%)",
        }}
      />
      <div
        className="animate-auth-drift-slow absolute h-[900px] w-[900px]"
        style={{
          top: "-10%",
          left: "50%",
          background:
            "radial-gradient(circle, rgba(124,111,240,0.12), transparent 70%)",
        }}
      />
      <div
        className="animate-auth-drift-slower absolute h-[500px] w-[500px]"
        style={{
          top: "40%",
          left: "-5%",
          background:
            "radial-gradient(circle, rgba(124,111,240,0.06), transparent 70%)",
        }}
      />
    </div>
  )
}
