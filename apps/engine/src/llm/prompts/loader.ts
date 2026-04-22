import { readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type PromptKind = "system" | "reviewers" | "workers"

export class PromptLoadError extends Error {
  constructor(
    message: string,
    readonly kind: PromptKind,
    readonly id: string,
    readonly path: string,
    readonly missing: boolean,
  ) {
    super(message)
    this.name = "PromptLoadError"
  }
}

const cache = new Map<string, string>()

function promptsRoot(): string {
  const override = process.env.BEERENGINEER_PROMPTS_DIR?.trim()
  if (override) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override)
  }

  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, "../../..", "prompts")
}

function stripLeadingHeading(text: string): string {
  return text.replace(/^# .*\r?\n(?:\r?\n)?/, "")
}

function promptPath(kind: PromptKind, id: string): string {
  return resolve(promptsRoot(), kind, `${id}.md`)
}

export function loadPrompt(kind: PromptKind, id: string): string {
  const cacheKey = `${kind}/${id}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const path = promptPath(kind, id)
  try {
    const prompt = stripLeadingHeading(readFileSync(path, "utf8"))
    cache.set(cacheKey, prompt)
    return prompt
  } catch (error) {
    const envOverride = process.env.BEERENGINEER_PROMPTS_DIR?.trim()
    const details = error instanceof Error ? error.message : String(error)
    const missing =
      typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"
    throw new PromptLoadError(
      `Failed to load prompt kind="${kind}" id="${id}" from "${path}". ` +
        `BEERENGINEER_PROMPTS_DIR=${envOverride ? JSON.stringify(envOverride) : "unset"}. ` +
        details,
      kind,
      id,
      path,
      missing,
    )
  }
}

export function clearPromptCache(): void {
  cache.clear()
}
