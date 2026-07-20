"use client"

import { useEffect, useRef, useState } from "react"

interface RevealProps {
  children: React.ReactNode
  className?: string
  id?: string
}

export function Reveal({ children, className, id }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
          }
        })
      },
      { threshold: 0.3 }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} id={id} data-visible={visible} className={`reveal ${className ?? ""}`}>
      {children}
    </div>
  )
}
