import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { CodebaseSnapshot } from "../types/context.js"

// `AGENTS.md` follows the agents.md convention (https://agents.md). When
// present at the workspace root it carries the project's house rules for
// AI coding agents — preferred libraries, commit conventions, "do not"s.
// Surfacing it here means engineering stages see it on turn 1 instead of
// having to discover it via tool calls. Nested AGENTS.md files (one per
// subtree) are deliberately not walked: the convention is "nearest wins",
// which we leave to the live filesystem since stage agents have read-only
// tool access and can read a closer file when working in a subtree.
const TOP_LEVEL_FILE_NAMES = ["README.md", "AGENTS.md", "package.json", "tsconfig.json"]
// Workspace docs (often produced by a previous run's documentation stage).
// Including them in the snapshot lets brownfield brainstorm / requirements /
// architecture see what the project already claims to be — what features
// shipped, the stated tech choices, the house style — instead of starting
// from a tree listing alone.
const WORKSPACE_DOC_FILE_NAMES = [
  "docs/AGENTS.md",
  "docs/architecture.md",
  "docs/api-contract.md",
  "docs/technical-doc.md",
  "docs/features-doc.md",
  "docs/README.compact.md",
]
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

function shouldSkipTreeEntry(name: string, depth: number): boolean {
  if (SKIP_DIRS.has(name)) return true
  return name.startsWith(".") && depth === TREE_DEPTH
}

function readTreeEntryKind(path: string): "dir" | "file" | undefined {
  try {
    return statSync(path).isDirectory() ? "dir" : "file"
  } catch {
    return undefined
  }
}

function walkTree(root: string, current: string, depth: number, out: string[]): void {
  if (depth < 0) return
  let entries: string[]
  try {
    entries = readdirSync(current).sort((left, right) => left.localeCompare(right))
  } catch {
    return
  }
  for (const name of entries) {
    if (shouldSkipTreeEntry(name, depth)) continue
    const full = join(current, name)
    const kind = readTreeEntryKind(full)
    if (!kind) continue
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
  for (const name of [...TOP_LEVEL_FILE_NAMES, ...WORKSPACE_DOC_FILE_NAMES]) {
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
