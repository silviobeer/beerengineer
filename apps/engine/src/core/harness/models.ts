import type { HarnessRole } from "../../types/workspace.js"

export type ProviderModels = {
  provider: string
  models: Array<{
    id: string
    aliases?: string[]
    default?: { role: HarnessRole }
  }>
}

export const PROVIDER_MODELS: ProviderModels[] = [
  {
    provider: "anthropic",
    models: [
      { id: "claude-opus-4-7", default: { role: "coder" } },
      { id: "claude-sonnet-4-6", default: { role: "reviewer" } },
      { id: "claude-haiku-4-5" },
    ],
  },
  {
    provider: "openai",
    models: [
      { id: "gpt-5-4", default: { role: "coder" } },
      { id: "gpt-4o", default: { role: "reviewer" } },
      { id: "o3" },
    ],
  },
  {
    provider: "openrouter",
    models: [],
  },
]

export const DEFAULT_HARNESS_MODELS = {
  "codex-first": {
    coder: { harness: "codex", provider: "openai", model: "gpt-5-4" },
    reviewer: { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6" },
  },
  "claude-first": {
    coder: { harness: "claude", provider: "anthropic", model: "claude-opus-4-7" },
    reviewer: { harness: "codex", provider: "openai", model: "gpt-4o" },
  },
  "codex-only": {
    coder: { harness: "codex", provider: "openai", model: "gpt-5-4" },
    reviewer: { harness: "codex", provider: "openai", model: "gpt-4o" },
  },
  "claude-only": {
    coder: { harness: "claude", provider: "anthropic", model: "claude-opus-4-7" },
    reviewer: { harness: "claude", provider: "anthropic", model: "claude-sonnet-4-6" },
  },
  fast: {
    coder: { harness: "codex", provider: "openai", model: "gpt-4o" },
    reviewer: { harness: "claude", provider: "anthropic", model: "claude-haiku-4-5" },
  },
} as const

export function isKnownModel(provider: string, model: string): boolean {
  const known = PROVIDER_MODELS.find(entry => entry.provider === provider)
  if (!known) return false
  return known.models.some(candidate => candidate.id === model || candidate.aliases?.includes(model))
}
