// Text-to-speech voices the report player offers. The landing page lists the same ones.
export const VOICES = {
  nova: "Female, warm, friendly",
  alloy: "Neutral, balanced",
  echo: "Male, clear",
  fable: "British, expressive",
  onyx: "Deep, authoritative",
  shimmer: "Female, energetic",
} as const

export type VoiceId = keyof typeof VOICES

export const DEFAULT_VOICE: VoiceId = "nova"
