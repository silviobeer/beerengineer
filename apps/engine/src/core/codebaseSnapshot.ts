import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { CodebaseSnapshot } from "../types/context.js"

const TOP_LEVEL_FILE_NAMES = ["README.md", "package.json", "tsconfig.json"]
const SPEC_PATH_HINTS = [
  "apps/engine/src/api/openapi.json",
  "spec/api-contract.md",
  "specs/api-contract.md",
]
const MAX_FILE_BYTES = 32 * 1024
const TREE_DEPTH = 2
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  ".bg-shell",
  ".beerengineer",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".vscode",
])

function readBoundedFile(path: string): string | undefined {
  try {
    const raw = readFileSync(path, "utf8")
    if (raw.length <= MAX_FILE_BYTES) return raw
    return raw.slice(0, MAX_FILE_BYTES) + `\n\n…[truncated, original ${raw.length} bytes]`
  } catch {
    return undefined
  }
}

function walkTree(root: string, current: string, depth: number, out: string[]): void {
  if (depth < 0) return
  let entries: string[]
  try {
    entries = readdirSync(current).sort()
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    if (name.startsWith(".") && depth === TREE_DEPTH) continue
    const full = join(current, name)
    let kind: "dir" | "file" | "other"
    try {
      kind = statSync(full).isDirectory() ? "dir" : "file"
    } catch {
      continue
    }
    const rel = relative(root, full) || name
    out.push(kind === "dir" ? `${rel}/` : rel)
    if (kind === "dir") walkTree(root, full, depth - 1, out)
  }
}

/**
 * Capture a compact view of the workspace so engineering stage agents
 * (requirements/architecture/planning/...) start with the existing reality
 * pre-loaded in their payload, instead of having to grep their way to the
 * api contract on every call. Stage agents still hold tools for deeper
 * inspection — this just removes the warm-up cost for the obvious files.
 */
export function loadCodebaseSnapshot(workspaceRoot: string | undefined): CodebaseSnapshot | undefined {
  if (!workspaceRoot || !existsSync(workspaceRoot)) return undefined
  const topLevelFiles: Array<{ path: string; content: string }> = []
  for (const name of TOP_LEVEL_FILE_NAMES) {
    const full = join(workspaceRoot, name)
    const content = readBoundedFile(full)
    if (content !== undefined) topLevelFiles.push({ path: name, content })
  }
  let openApiSpec: string | undefined
  for (const hint of SPEC_PATH_HINTS) {
    const full = join(workspaceRoot, hint)
    const content = readBoundedFile(full)
    if (content !== undefined) {
      openApiSpec = `// ${hint}\n${content}`
      break
    }
  }
  const treeSummary: string[] = []
  walkTree(workspaceRoot, workspaceRoot, TREE_DEPTH, treeSummary)
  return { topLevelFiles, treeSummary, openApiSpec }
}
