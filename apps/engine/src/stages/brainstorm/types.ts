import type { ChatMessage } from "../../llm/types.js"
import type { Concept, Item, Project } from "../../types.js"
import type { CodebaseSnapshot } from "../../types/context.js"

export type BrainstormArtifact = {
  concept: Concept & { hasUi: boolean }
  projects: Project[]
}

/**
 * Coerce a value that should be `string[]` to an actual `string[]`.
 *
 * The real LLM occasionally serialises array fields as a single string
 * (e.g. `"constraints": "Hard boundary: ...; ..."`). This function normalises
 * all four shapes before the artifact is persisted, so downstream code can
 * safely spread the array.
 *
 *   string[]              → unchanged
 *   string                → split on newline / bullet markers, or wrap as [value]
 *   null / undefined      → []
 *   non-string[]          → each element stringified
 */
export function coerceToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v))
  if (value == null) return []
  if (typeof value === "string") {
    const lines = value.split(/\r?\n/).map(s => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean)
    return lines.length > 0 ? lines : [value]
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(v => String(v))
  }
  return [String(value)]
}

/**
 * Normalise a raw `BrainstormArtifact` that may contain string-typed array
 * fields (real-LLM serialisation drift). Returns a new object with
 * `constraints` and `users` guaranteed to be `string[]` on both the top-level
 * concept and every project concept.
 */
export function normalizeBrainstormArtifact(raw: BrainstormArtifact): BrainstormArtifact {
  function normalizeConcept<T extends { users: string[]; constraints: string[] }>(c: T | string | null | undefined): T {
    // Real LLMs occasionally return the entire concept object as a single
    // string. Spreading a string yields character-indexed keys (`{0:"A",
    // 1:" ", …}`), which then poison every downstream consumer that expects
    // a real Concept. Treat that as `summary` and synthesize the rest.
    if (typeof c === "string" || c == null) {
      return {
        summary: typeof c === "string" ? c : "",
        problem: "",
        users: [],
        constraints: [],
      } as unknown as T
    }
    return { ...c, users: coerceToStringArray(c.users), constraints: coerceToStringArray(c.constraints) }
  }
  return {
    concept: normalizeConcept(raw.concept),
    projects: raw.projects.map(p => ({ ...p, concept: normalizeConcept(p.concept) })),
  }
}

export type BrainstormState = {
  item: Item
  questionsAsked: number
  targetQuestions: number
  history: ChatMessage[]
  codebase?: CodebaseSnapshot
}
