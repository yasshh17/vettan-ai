// The guard has to catch both transports. The browser QA mock caught only fetch, so the axios
// fallback POST (XMLHttpRequest) reached the real backend; this pins that it can't here.
import axios from "axios"
import { afterEach, describe, expect, it, vi } from "vitest"
import { blockNetwork } from "./block-network"

afterEach(() => vi.unstubAllGlobals())

describe("blockNetwork", () => {
  it("refuses and records a fetch", async () => {
    const attempts = blockNetwork()
    await expect(fetch("http://localhost:8000/api/research/stream")).rejects.toThrow("Network blocked")
    expect(attempts).toEqual(["fetch http://localhost:8000/api/research/stream"])
  })

  it("refuses and records an axios request, which goes over XMLHttpRequest", async () => {
    const attempts = blockNetwork()
    await expect(axios.post("http://localhost:8000/api/research", { query: "q" })).rejects.toBeTruthy()
    expect(attempts).toEqual(["xhr POST http://localhost:8000/api/research"])
  })
})
