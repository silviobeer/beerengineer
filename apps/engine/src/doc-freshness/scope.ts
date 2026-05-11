import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

export const CANONICAL_DOC_PATHS = [
  "README.md",
  "AGENTS.md",
  "docs/AGENTS.md",
  "docs/PROJECT.md",
  "docs/TECHNICAL.md",
  "apps/ui/README.md",
  "apps/engine/docs/AGENTS.md",
  "apps/ui/docs/AGENTS.md",
] as const

export const ROOT_DIRECTORY_REFERENCE_PREFIXES = [
  "apps/",
  "docs/",
  "specs/",
  "skills/",
  "scripts/",
  "supabase/",
  ".beerengineer/",
] as const

const COMPLETED_PROJECT_DIR_PATTERN = /^PROJ-\d+-/
const DOCS_ADR_DIR = "docs/adr"

type DependencyMap = Record<string, string>

export interface PackageJsonManifest {
  name?: string
  version?: string
  dependencies?: DependencyMap
  devDependencies?: DependencyMap
  peerDependencies?: DependencyMap
  optionalDependencies?: DependencyMap
  [key: string]: unknown
}

export interface FreshnessDocument {
  docPath: string
  absolutePath: string
  content: string
}

export interface FreshnessPackageManifest {
  manifestPath: string
  absolutePath: string
  manifest: PackageJsonManifest
}

export interface CompletedProjectEvidence {
  projId: string
  projectPath: string
  progressPath: string
  evidencePaths: readonly string[]
}

export interface ScopedDirectoryReference {
  referencedPath: string
  absolutePath: string
  repoPath: string
}

export interface DocFreshnessScope {
  rootPath: string
  docs: readonly FreshnessDocument[]
  packageManifests: readonly FreshnessPackageManifest[]
  completedProjects: readonly CompletedProjectEvidence[]
}

export function resolveDocFreshnessScope(rootPath = process.cwd()): DocFreshnessScope {
  const normalizedRoot = resolve(rootPath)

  return {
    rootPath: normalizedRoot,
    docs: resolveScopedDocs(normalizedRoot),
    packageManifests: resolveScopedPackageManifests(normalizedRoot),
    completedProjects: resolveCompletedProjects(normalizedRoot),
  }
}

export function normalizeDirectoryReferenceCandidate(candidate: string): string | null {
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) return null
  if (candidate.startsWith("mailto:")) return null
  if (candidate.startsWith("#")) return null
  if (candidate.startsWith("/")) return null
  if (candidate.startsWith("~") || candidate.startsWith("@")) return null
  if (candidate.includes("*") || candidate.includes("<") || candidate.includes(">")) return null

  const withoutAnchor = candidate.split("#")[0]
  const trimmed = withoutAnchor.replace(/[),.;:]+$/, "")
  if (trimmed.length === 0) return null

  if (ROOT_DIRECTORY_REFERENCE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return trimmed
  }
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed.endsWith("/") ? trimmed : null
  }
  if (/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/$/.test(trimmed)) {
    return trimmed
  }

  return null
}

export function resolveScopedDirectoryReference(
  rootPath: string,
  docPath: string,
  candidate: string,
): ScopedDirectoryReference | null {
  const normalizedRoot = resolve(rootPath)
  const normalizedCandidate = normalizeDirectoryReferenceCandidate(candidate)
  if (!normalizedCandidate) return null

  const docDir = dirname(join(normalizedRoot, docPath))
  const docDirectoryIsRoot = dirname(docPath) === "."
  let absolutePath: string | null = null

  if (normalizedCandidate.startsWith("./") || normalizedCandidate.startsWith("../")) {
    absolutePath = resolve(docDir, normalizedCandidate)
  } else if (
    ROOT_DIRECTORY_REFERENCE_PREFIXES.some((prefix) =>
      normalizedCandidate.startsWith(prefix),
    )
  ) {
    absolutePath = resolve(normalizedRoot, normalizedCandidate)
  } else if (!docDirectoryIsRoot) {
    absolutePath = resolve(docDir, normalizedCandidate)
  }

  if (!absolutePath) return null
  if (!isPathInsideRoot(normalizedRoot, absolutePath)) return null

  return {
    referencedPath: normalizedCandidate.split(sep).join("/"),
    absolutePath,
    repoPath: toRepoPath(normalizedRoot, absolutePath),
  }
}

export function scopedDirectoryExists(
  rootPath: string,
  docPath: string,
  candidate: string,
): boolean | null {
  const resolved = resolveScopedDirectoryReference(rootPath, docPath, candidate)
  if (!resolved) return null
  if (!existsSync(resolved.absolutePath)) return false
  return statSync(resolved.absolutePath).isDirectory()
}

function resolveScopedDocs(rootPath: string): readonly FreshnessDocument[] {
  const docs: FreshnessDocument[] = []

  for (const docPath of CANONICAL_DOC_PATHS) {
    const absolutePath = join(rootPath, docPath)
    if (!existsSync(absolutePath)) continue
    docs.push({
      docPath,
      absolutePath,
      content: readFileSync(absolutePath, "utf8"),
    })
  }

  const adrDir = join(rootPath, DOCS_ADR_DIR)
  if (existsSync(adrDir)) {
    const entries = readdirSync(adrDir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(".md")) continue

      const absolutePath = join(adrDir, entry.name)
      docs.push({
        docPath: toRepoPath(rootPath, absolutePath),
        absolutePath,
        content: readFileSync(absolutePath, "utf8"),
      })
    }
  }

  return docs.sort((left, right) => left.docPath.localeCompare(right.docPath))
}

function resolveScopedPackageManifests(
  rootPath: string,
): readonly FreshnessPackageManifest[] {
  const manifests: FreshnessPackageManifest[] = []

  const rootManifestPath = join(rootPath, "package.json")
  if (existsSync(rootManifestPath)) {
    manifests.push({
      manifestPath: "package.json",
      absolutePath: rootManifestPath,
      manifest: readJson<PackageJsonManifest>(rootManifestPath),
    })
  }

  const appsDir = join(rootPath, "apps")
  if (existsSync(appsDir)) {
    const appEntries = readdirSync(appsDir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    for (const entry of appEntries) {
      if (!entry.isDirectory()) continue

      const manifestPath = join("apps", entry.name, "package.json")
      const absolutePath = join(rootPath, manifestPath)
      if (!existsSync(absolutePath)) continue

      manifests.push({
        manifestPath,
        absolutePath,
        manifest: readJson<PackageJsonManifest>(absolutePath),
      })
    }
  }

  return manifests
}

function resolveCompletedProjects(
  rootPath: string,
): readonly CompletedProjectEvidence[] {
  const specsDir = join(rootPath, "specs")
  if (!existsSync(specsDir)) return []

  const completedProjects: CompletedProjectEvidence[] = []
  const entries = readdirSync(specsDir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!COMPLETED_PROJECT_DIR_PATTERN.test(entry.name)) continue

    const progressDir = join(specsDir, entry.name, "7_progress")
    if (!existsSync(progressDir)) continue
    if (!statSync(progressDir).isDirectory()) continue

    const evidencePaths = walkFiles(progressDir)
      .filter((absolutePath) => absolutePath.endsWith(".md"))
      .map((absolutePath) => toRepoPath(rootPath, absolutePath))
    if (evidencePaths.length === 0) continue

    const projId = entry.name.match(/^(PROJ-\d+)/)?.[1]
    if (!projId) continue

    completedProjects.push({
      projId,
      projectPath: `specs/${entry.name}`,
      progressPath: `specs/${entry.name}/7_progress`,
      evidencePaths,
    })
  }

  return completedProjects
}

function walkFiles(absoluteDir: string): string[] {
  if (!existsSync(absoluteDir)) return []

  const files: string[] = []
  const entries = readdirSync(absoluteDir, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )

  for (const entry of entries) {
    const entryPath = join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
      continue
    }

    files.push(entryPath)
  }

  return files
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && relativePath !== ""
    ? true
    : candidatePath === rootPath
}

function toRepoPath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).split(sep).join("/")
}

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T
}
