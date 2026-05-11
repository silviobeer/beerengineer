import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"

import type { RunLlmConfig } from "../llm/registry.js"
import type { Item } from "../types.js"
import { loadPreparedImportBundleWithLlmFallback, type PreparedImportBundle } from "./preparedImport.js"
import { layout, type WorkflowContext } from "./workspaceLayout.js"

export type ImportContextStatus = "full" | "partial" | "empty" | "unavailable"
export type ImportContextFileOutcome = {
  path: string
  outcome: "visible" | "omitted"
  reason:
    | "concept_json"
    | "concept_markdown"
    | "projects_json"
    | "prd_json"
    | "prd_markdown"
    | "unsupported"
}

export type ImportContextArtifact = {
  status: ImportContextStatus
  files: ImportContextFileOutcome[]
  context: {
    conceptSummary: string
    hasUi: boolean
    projectIds: string[]
    prdProjectIds: string[]
  }
  warnings: string[]
}

export type GeneratedImportContext = {
  bundle: PreparedImportBundle
  importContext: ImportContextArtifact
}

export type ImportContextGeneratorInput = {
  sourceDir: string
  item: Pick<Item, "title" | "description">
  llm?: RunLlmConfig
}

export type ImportContextGenerator = (input: ImportContextGeneratorInput) => Promise<GeneratedImportContext>

function compareAlphabetically(left: string, right: string): number {
  return left.localeCompare(right)
}

function collectFiles(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  return entries
    .map(name => join(root, name))
    .flatMap(path => {
      let stat
      try {
        stat = lstatSync(path)
      } catch {
        return []
      }
      if (stat.isSymbolicLink()) return []
      if (stat.isDirectory()) return collectFiles(path)
      return stat.isFile() ? [path] : []
    })
}

function relativeImportPath(sourceDir: string, file: string): string {
  return relative(sourceDir, file).split(sep).join("/")
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel)
}

function isPrdJsonFile(relativePath: string, base: string): boolean {
  return base === "prd.json" || base.endsWith(".prd.json") || /^prds\//i.test(relativePath) || /^3_PRDs\//i.test(relativePath)
}

function isVisibleMarkdownContent(content: string, relativePath: string): boolean {
  return /^###\s+(US-[\w-]+|Story\s+\d+)/im.test(content) || /^3_PRDs\//i.test(relativePath) || /^prds\//i.test(relativePath)
}

function visibleMarkdownFiles(sourceDir: string, files: string[]): Set<string> {
  const conceptFile =
    files.find(path => /(?:^|\/)1_brainstorm\/.*concept.*\.md$/i.test(path)) ??
    files.find(path => path.toLowerCase().endsWith("concept.md")) ??
    files.find(path => extname(path).toLowerCase() === ".md")

  const conceptPath = conceptFile ? resolve(conceptFile) : null
  const visible = new Set<string>()
  if (conceptPath) visible.add(conceptPath)

  for (const file of files) {
    if (extname(file).toLowerCase() !== ".md" || resolve(file) === conceptPath) continue
    const rel = relativeImportPath(sourceDir, file)
    let content: string
    try {
      content = readFileSync(file, "utf8")
    } catch {
      continue
    }
    if (isVisibleMarkdownContent(content, rel)) visible.add(resolve(file))
  }
  return visible
}

function jsonOutcome(sourceDir: string, file: string): ImportContextFileOutcome {
  const rel = relativeImportPath(sourceDir, file)
  const base = basename(file).toLowerCase()
  try {
    JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return { path: rel, outcome: "omitted", reason: "unsupported" }
  }
  if (base === "concept.json") return { path: rel, outcome: "visible", reason: "concept_json" }
  if (base === "projects.json") return { path: rel, outcome: "visible", reason: "projects_json" }
  if (isPrdJsonFile(rel, base)) return { path: rel, outcome: "visible", reason: "prd_json" }
  return { path: rel, outcome: "omitted", reason: "unsupported" }
}

function importContextMetadata(bundle: PreparedImportBundle): ImportContextArtifact["context"] {
  return {
    conceptSummary: bundle.concept.summary,
    hasUi: bundle.concept.hasUi === true,
    projectIds: bundle.projects.map(project => project.id),
    prdProjectIds: Object.keys(bundle.prdsByProjectId).sort(compareAlphabetically),
  }
}

function buildImportContextArtifact(sourceDir: string, bundle: PreparedImportBundle): ImportContextArtifact {
  const files = collectFiles(sourceDir)
    .map(file => resolve(file))
    .filter(file => !isPathInside(join(resolve(sourceDir), ".beerengineer"), file))
    .sort((left, right) => compareAlphabetically(relativeImportPath(sourceDir, left), relativeImportPath(sourceDir, right)))

  if (files.length === 0) {
    return {
      status: "empty",
      files: [],
      context: importContextMetadata(bundle),
      warnings: bundle.warnings,
    }
  }

  const visibleMarkdown = visibleMarkdownFiles(sourceDir, files)
  const outcomes = files.map<ImportContextFileOutcome>(file => {
    const rel = relativeImportPath(sourceDir, file)
    const ext = extname(file).toLowerCase()
    if (ext === ".json") return jsonOutcome(sourceDir, file)
    if (ext === ".md") {
      if (visibleMarkdown.has(resolve(file))) {
        const reason = /concept/i.test(basename(file)) ? "concept_markdown" : "prd_markdown"
        return { path: rel, outcome: "visible", reason }
      }
    }
    return { path: rel, outcome: "omitted", reason: "unsupported" }
  })
  const visibleCount = outcomes.filter(file => file.outcome === "visible").length
  let status: ImportContextStatus = "partial"
  if (visibleCount === 0) status = "empty"
  else if (visibleCount === outcomes.length) status = "full"

  return {
    status,
    files: outcomes,
    context: importContextMetadata(bundle),
    warnings: bundle.warnings,
  }
}

export const defaultImportContextGenerator: ImportContextGenerator = async ({ sourceDir, item, llm }) => {
  const bundle = await loadPreparedImportBundleWithLlmFallback(sourceDir, item, llm)
  try {
    return { bundle, importContext: buildImportContextArtifact(sourceDir, bundle) }
  } catch (error) {
    return {
      bundle,
      importContext: {
        status: "unavailable",
        files: [],
        context: importContextMetadata(bundle),
        warnings: [...bundle.warnings, `import-context generation unavailable: ${(error as Error).message}`],
      },
    }
  }
}

export async function generateImportContext(
  sourceDir: string,
  item: Pick<Item, "title" | "description">,
  llm?: RunLlmConfig,
): Promise<GeneratedImportContext> {
  return defaultImportContextGenerator({ sourceDir, item, llm })
}

export function importContextArtifactPath(context: WorkflowContext): string {
  return join(layout.runDir(context), "imports", "import-context.json")
}

export function writeImportContextArtifact(context: WorkflowContext, artifact: ImportContextArtifact): string {
  const path = importContextArtifactPath(context)
  mkdirSync(join(layout.runDir(context), "imports"), { recursive: true })
  writeFileSync(path, JSON.stringify(artifact, null, 2))
  return path
}

export async function readImportContextArtifact(context: WorkflowContext): Promise<ImportContextArtifact | null> {
  try {
    return JSON.parse(await readFile(importContextArtifactPath(context), "utf8")) as ImportContextArtifact
  } catch {
    return null
  }
}
