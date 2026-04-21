export type { StageAgentAdapter, ReviewAgentAdapter } from "../core/adapters.js"

export type ProviderId = "fake" | "codex" | "claude-code"

export type ChatMessage = {
  role: "system" | "assistant" | "user"
  text: string
}
