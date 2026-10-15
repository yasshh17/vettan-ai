"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

// Replaces the root layout, so globals.css isn't loaded and styles are inline.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#e5e5e5",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>Something went wrong - Vettan AI</title>
        <div style={{ textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#a3a3a3", margin: "0 0 20px" }}>
            The error has been reported. Try again, or reload the page.
          </p>
          <button
            onClick={() => retry()}
            style={{
              background: "#e5e5e5",
              color: "#0a0a0a",
              border: 0,
              borderRadius: 8,
              padding: "8px 16px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
