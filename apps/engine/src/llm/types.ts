export type { StageAgentAdapter, ReviewAgentAdapter } from "../core/adapters.js"

export type ProviderId = "fake" | "codex" | "claude-code" | "opencode"

/**
 * Invocation mechanism for a hosted harness. `cli` shells out to the local
 * agent CLI ("claude", "codex"); `sdk` runs the agent loop in-process via the
 * vendor's agent SDK. The choice is independent of harness brand and API
 * vendor: see `ResolvedHarness` in `./registry.ts`.
 */
export type InvocationRuntime = "cli" | "sdk"

export type ChatMessage = {
  role: "system" | "assistant" | "user"
  text: string
}
