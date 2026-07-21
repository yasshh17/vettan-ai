"use client"

import { useEffect, useRef } from "react"

interface DottedSurfaceProps {
  className?: string
}

const dotPalette = ["#7C6FF0", "#9C90FF", "#B6ACFF"]
const desktopSpacing = 26
const compactSpacing = 34
const compactBreakpoint = 640
const minRadius = 0.6
const maxRadius = 1.6
const minAlpha = 0.12
const maxAlpha = 0.5
const spatialFrequency = 0.011
const temporalSpeed = 0.00105
const maxPixelRatio = 2
const resizeDebounce = 150

export function DottedSurface({ className }: DottedSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const context = canvas.getContext("2d")
    if (!context) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")

    let width = 0
    let height = 0
    let spacing = desktopSpacing
    let animationFrame: number | null = null
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let running = false
    let onScreen = true

    const paint = (timestamp: number) => {
      context.clearRect(0, 0, width, height)
      for (let x = 0; x <= width; x += spacing) {
        for (let y = 0; y <= height; y += spacing) {
          const intensity =
            (Math.sin((x + y) * spatialFrequency - timestamp * temporalSpeed) + 1) / 2
          const band = Math.min(dotPalette.length - 1, Math.floor(intensity * dotPalette.length))
          context.globalAlpha = minAlpha + intensity * (maxAlpha - minAlpha)
          context.fillStyle = dotPalette[band]
          context.beginPath()
          context.arc(x, y, minRadius + intensity * (maxRadius - minRadius), 0, Math.PI * 2)
          context.fill()
        }
      }
      context.globalAlpha = 1
    }

    const loop = (timestamp: number) => {
      paint(timestamp)
      animationFrame = requestAnimationFrame(loop)
    }

    const stop = () => {
      running = false
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
    }

    const start = () => {
      if (running || reducedMotion.matches) return
      running = true
      animationFrame = requestAnimationFrame(loop)
    }

    const sync = () => {
      if (onScreen && !document.hidden) start()
      else stop()
    }

    const configure = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
      const rect = parent.getBoundingClientRect()
      width = rect.width
      height = rect.height
      spacing = width < compactBreakpoint ? compactSpacing : desktopSpacing
      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

    const applyMotionPreference = () => {
      if (reducedMotion.matches) {
        stop()
        paint(0)
      } else {
        sync()
      }
    }

    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        configure()
        if (reducedMotion.matches) paint(0)
      }, resizeDebounce)
    }

    configure()
    applyMotionPreference()

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(parent)

    const viewportObserver = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true
        sync()
      },
      { threshold: 0 }
    )
    viewportObserver.observe(canvas)

    document.addEventListener("visibilitychange", sync)
    reducedMotion.addEventListener("change", applyMotionPreference)

    return () => {
      stop()
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      viewportObserver.disconnect()
      document.removeEventListener("visibilitychange", sync)
      reducedMotion.removeEventListener("change", applyMotionPreference)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
