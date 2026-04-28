import { readFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type PromptKind = "system" | "reviewers" | "workers"
export type PromptBundleId = string
export type PromptLoadSource = "prompt" | "bundle"

export class PromptLoadError extends Error {
  constructor(
    message: string,
    readonly kind: PromptKind,
    readonly id: string,
    readonly path: string,
    readonly missing: boolean,
    readonly source: PromptLoadSource = "prompt",
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

  // Assumes tsx-style execution with source layout src/llm/prompts/loader.ts;
  // if a build step ever flattens output, override via BEERENGINEER_PROMPTS_DIR.
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, "../../..", "prompts")
}

function stripLeadingHeading(text: string): string {
  return text.replace(/^# .*\r?\n(?:\r?\n)?/, "")
}

function promptPath(kind: PromptKind, id: string): string {
  return resolve(promptsRoot(), kind, `${id}.md`)
}

function bundlePath(id: PromptBundleId): string {
  if (!/^[a-z0-9][a-z0-9/-]*$/i.test(id) || id.includes("//")) {
    throw new PromptLoadError(`Invalid prompt bundle id "${id}".`, "system", id, id, false, "bundle")
  }

  const root = resolve(promptsRoot(), "references")
  const path = resolve(root, `${id}.md`)
  const rel = relative(root, path)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PromptLoadError(`Prompt bundle id "${id}" resolves outside the references directory.`, "system", id, path, false, "bundle")
  }

  return path
}

function readPromptFile(kind: PromptKind, id: string): string {
  const path = promptPath(kind, id)
  try {
    return stripLeadingHeading(readFileSync(path, "utf8"))
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
      "prompt",
    )
  }
}

function readBundleFile(kind: PromptKind, id: PromptBundleId): string {
  const path = bundlePath(id)
  try {
    return stripLeadingHeading(readFileSync(path, "utf8"))
  } catch (error) {
    const envOverride = process.env.BEERENGINEER_PROMPTS_DIR?.trim()
    const details = error instanceof Error ? error.message : String(error)
    const missing =
      typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"
    throw new PromptLoadError(
      `Failed to load prompt bundle id="${id}" from "${path}". ` +
        `BEERENGINEER_PROMPTS_DIR=${envOverride ? JSON.stringify(envOverride) : "unset"}. ` +
        details,
      kind,
      id,
      path,
      missing,
      "bundle",
    )
  }
}

function normalizeBundleIds(bundleIds: readonly PromptBundleId[]): PromptBundleId[] {
  const seen = new Set<PromptBundleId>()
  for (const bundleId of bundleIds) {
    if (seen.has(bundleId)) {
      throw new PromptLoadError(`Duplicate prompt bundle id "${bundleId}".`, "system", bundleId, bundleId, false, "bundle")
    }
    seen.add(bundleId)
  }
  return [...bundleIds].sort((left, right) => left.localeCompare(right))
}

export function loadPrompt(kind: PromptKind, id: string): string {
  const cacheKey = `${kind}/${id}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const prompt = readPromptFile(kind, id)
  cache.set(cacheKey, prompt)
  return prompt
}

export function loadComposedPrompt(kind: PromptKind, id: string, bundleIds: readonly PromptBundleId[] = []): string {
  const normalizedBundleIds = normalizeBundleIds(bundleIds)
  if (normalizedBundleIds.length === 0) return loadPrompt(kind, id)

  const cacheKey = `${kind}/${id}::${normalizedBundleIds.join(",")}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const prompt = loadPrompt(kind, id)
  const references = normalizedBundleIds.map((bundleId) => readBundleFile(kind, bundleId).trimEnd()).join("\n\n")
  const composed = `${prompt.trimEnd()}\n\n## References\n\n${references}\n`
  cache.set(cacheKey, composed)
  return composed
}

export function clearPromptCache(): void {
  cache.clear()
}
