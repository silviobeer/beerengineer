import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const IN_SCOPE_DOCS = [
  "README.md",
  "AGENTS.md",
  "docs/AGENTS.md",
  "docs/PROJECT.md",
  "docs/TECHNICAL.md",
]

const ROOT_PATH_PREFIXES = [
  "apps/",
  "docs/",
  "specs/",
  "skills/",
  "scripts/",
  "supabase/",
  ".beerengineer/",
]

const DEPENDENCY_CLAIM_PATTERN =
  /(?<![A-Za-z0-9_./-])(?<package>@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@(?<version>[\^~]?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)*)/gi

const FENCED_CODE_DELIMITER_PATTERN = /^\s*```/
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)\s]+)\)/g
const LEADING_PATH_PATTERN =
  /^\s*(?<path>[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._*-]+)+(?:\/)?(?:[A-Za-z0-9._-]+)?)/
const CURRENT_DEPENDENCY_CONTEXT_PATTERN =
  /\b(active|canonical|current|depends on|dependencies|dependency|installed|package|packages|pinned|requires|ships with|tooling|use|uses)\b/i
const NON_CURRENT_DEPENDENCY_CONTEXT_PATTERN =
  /\b(example|examples|for example|historical|migration|migrated|previous|removed|sample|samples|snippet|snippets|used to)\b/i
const ACTIVE_PATH_CONTEXT_PATTERN =
  /\b(active|canonical|current|directory|directories|docs|entry|home|lives|live|located|look|open|path|paths|read|reference|references|route|routes|source|sources|start at|stored|structure|under|use|uses)\b/i
const HISTORICAL_CONTEXT_PATTERN =
  /\b(archive|archived|former|formerly|historical|moved|no longer active|no longer current|no longer exists|previous|removed|retired|used to|was a historical mistake|wrong location)\b/i

function toRepoPath(rootPath, absolutePath) {
  return relative(rootPath, absolutePath).split(sep).join("/")
}

function readJson(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, "utf8"))
}

function walkFiles(absoluteDir) {
  if (!existsSync(absoluteDir)) return []

  const files = []
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const entryPath = join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
      continue
    }

    files.push(entryPath)
  }

  return files
}

function getInScopeDocs(rootPath) {
  const docs = []

  for (const relativePath of IN_SCOPE_DOCS) {
    const absolutePath = join(rootPath, relativePath)
    if (!existsSync(absolutePath)) continue
    docs.push({
      docPath: relativePath,
      absolutePath,
      content: readFileSync(absolutePath, "utf8"),
    })
  }

  const adrDir = join(rootPath, "docs", "adr")
  if (existsSync(adrDir)) {
    for (const entry of readdirSync(adrDir, { withFileTypes: true })) {
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

  docs.sort((left, right) => left.docPath.localeCompare(right.docPath))
  return docs
}

function getCompletedProjects(rootPath) {
  const specsDir = join(rootPath, "specs")
  if (!existsSync(specsDir)) return []

  const completed = []
  for (const entry of readdirSync(specsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!/^PROJ-\d+-/.test(entry.name)) continue

    const progressDir = join(specsDir, entry.name, "7_progress")
    if (!existsSync(progressDir)) continue
    if (!statSync(progressDir).isDirectory()) continue

    const logs = walkFiles(progressDir).filter((filePath) => filePath.endsWith(".md"))
    if (logs.length === 0) continue

    const projId = entry.name.match(/^(PROJ-\d+)/)?.[1]
    if (!projId) continue

    completed.push({
      projId,
      projectPath: `specs/${entry.name}`,
      progressPath: `specs/${entry.name}/7_progress`,
      logCount: logs.length,
    })
  }

  completed.sort((left, right) => left.projId.localeCompare(right.projId))
  return completed
}

function listManifestPaths(rootPath) {
  const manifestPaths = []
  const rootManifestPath = join(rootPath, "package.json")
  if (existsSync(rootManifestPath)) manifestPaths.push("package.json")

  const appsDir = join(rootPath, "apps")
  if (!existsSync(appsDir)) return manifestPaths

  const appManifests = []
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join("apps", entry.name, "package.json")
    if (!existsSync(join(rootPath, manifestPath))) continue
    appManifests.push(manifestPath)
  }

  appManifests.sort((left, right) => left.localeCompare(right))
  manifestPaths.push(...appManifests)
  return manifestPaths
}

function buildManifestEntries(rootPath) {
  const entries = new Map()

  for (const manifestPath of listManifestPaths(rootPath)) {
    const absolutePath = join(rootPath, manifestPath)
    if (!existsSync(absolutePath)) continue

    const manifest = readJson(absolutePath)
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const dependencyMap = manifest[field] ?? {}
      for (const [packageName, version] of Object.entries(dependencyMap)) {
        const existing = entries.get(packageName) ?? []
        existing.push({ manifestPath, version, field })
        entries.set(packageName, existing)
      }
    }
  }

  return entries
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findMissingProjects(rootPath, docsProjectContent) {
  const findings = []
  for (const completedProject of getCompletedProjects(rootPath)) {
    const exactProjPattern = new RegExp(`\\b${escapeRegExp(completedProject.projId)}\\b`)
    if (exactProjPattern.test(docsProjectContent)) continue

    findings.push({
      ...completedProject,
      docPath: "docs/PROJECT.md",
    })
  }

  return findings
}

function isCurrentDependencyClaim(line, previousContextLine = "") {
  if (NON_CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(line)) return false
  if (CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(line)) return true
  if (!previousContextLine) return false
  if (NON_CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(previousContextLine)) return false
  return CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(previousContextLine)
}

function findDependencyClaimDrift(rootPath, docs) {
  const manifestEntries = buildManifestEntries(rootPath)
  const findings = []

  for (const doc of docs) {
    const lines = doc.content.split(/\r?\n/)
    let insideFencedCodeBlock = false
    let previousContextLine = ""
    for (const [index, line] of lines.entries()) {
      if (FENCED_CODE_DELIMITER_PATTERN.test(line)) {
        insideFencedCodeBlock = !insideFencedCodeBlock
        continue
      }

      if (insideFencedCodeBlock) continue
      if (!isCurrentDependencyClaim(line, previousContextLine)) {
        if (line.trim().length > 0) previousContextLine = line
        continue
      }

      for (const match of line.matchAll(DEPENDENCY_CLAIM_PATTERN)) {
        const packageName = match.groups?.package
        const claimedVersion = match.groups?.version
        if (!packageName || !claimedVersion) continue

        const manifestClaims = manifestEntries.get(packageName)
        if (!manifestClaims || manifestClaims.length === 0) {
          findings.push({
            docPath: doc.docPath,
            lineNumber: index + 1,
            packageName,
            claimedVersion,
            manifestPath: null,
            actualVersion: null,
            claim: `${packageName}@${claimedVersion}`,
          })
          continue
        }
        if (manifestClaims.some((entry) => entry.version === claimedVersion)) continue

        const conflictingManifest = manifestClaims[0]
        findings.push({
          docPath: doc.docPath,
          lineNumber: index + 1,
          packageName,
          claimedVersion,
          manifestPath: conflictingManifest.manifestPath,
          actualVersion: conflictingManifest.version,
          claim: `${packageName}@${claimedVersion}`,
        })
      }

      if (line.trim().length > 0) previousContextLine = line
    }
  }

  return findings
}

function isHistoricalContext(line) {
  return HISTORICAL_CONTEXT_PATTERN.test(line)
}

function isCurrentPathContext(line, referencedPath) {
  if (ACTIVE_PATH_CONTEXT_PATTERN.test(line)) return true

  const trimmed = line.trimStart()
  if (trimmed.startsWith(referencedPath)) return true
  if (trimmed.startsWith(`\`${referencedPath}\``)) return true

  return false
}

function normalizeCandidate(candidate) {
  if (!candidate) return null
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) return null
  if (candidate.startsWith("mailto:")) return null
  if (candidate.startsWith("#")) return null
  if (candidate.startsWith("/")) return null
  if (candidate.startsWith("~") || candidate.startsWith("@")) return null
  if (candidate.includes("*") || candidate.includes("<") || candidate.includes(">")) return null

  const withoutAnchor = candidate.split("#")[0]
  const trimmed = withoutAnchor.replace(/[),.;:]+$/, "")
  if (trimmed.length === 0) return null

  if (!trimmed.endsWith("/")) return null
  if (ROOT_PATH_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return trimmed
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) return trimmed
  if (/^[A-Za-z0-9._-]+\/$/.test(trimmed)) return trimmed

  return null
}

function collectPathCandidates(line) {
  const candidates = []

  for (const match of line.matchAll(INLINE_CODE_PATTERN)) {
    candidates.push(match[1])
  }

  for (const match of line.matchAll(MARKDOWN_LINK_PATTERN)) {
    candidates.push(match[1])
  }

  const leadingPath = line.match(LEADING_PATH_PATTERN)?.groups?.path
  if (leadingPath) {
    candidates.push(leadingPath)
  }

  return [...new Set(candidates)]
}

function resolveDocCandidate(rootPath, docPath, candidate) {
  const docDir = dirname(join(rootPath, docPath))
  let absolutePath = null

  if (candidate.startsWith("./") || candidate.startsWith("../")) {
    absolutePath = resolve(docDir, candidate)
  } else if (ROOT_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
    absolutePath = resolve(rootPath, candidate)
  } else if (/^[A-Za-z0-9._-]+\/$/.test(candidate)) {
    const docRelativePath = resolve(docDir, candidate)
    const rootRelativePath = resolve(rootPath, candidate)

    if (existsSync(docRelativePath)) {
      absolutePath = docRelativePath
    } else if (existsSync(rootRelativePath)) {
      absolutePath = rootRelativePath
    } else {
      absolutePath = rootRelativePath
    }
  }

  if (!absolutePath) return null

  if (!absolutePath.startsWith(resolve(rootPath))) return null

  return {
    referencedPath: candidate.split(sep).join("/"),
    resolvedPath: absolutePath,
  }
}

function findStalePathReferences(rootPath, docs) {
  const findings = []

  for (const doc of docs) {
    const lines = doc.content.split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (isHistoricalContext(line)) continue

      for (const rawCandidate of collectPathCandidates(line)) {
        const candidate = normalizeCandidate(rawCandidate)
        if (!candidate) continue
        if (!isCurrentPathContext(line, rawCandidate)) continue

        const resolved = resolveDocCandidate(rootPath, doc.docPath, candidate)
        if (!resolved) continue
        if (existsSync(resolved.resolvedPath)) continue

        findings.push({
          docPath: doc.docPath,
          lineNumber: index + 1,
          referencedPath: resolved.referencedPath,
        })
      }
    }
  }

  return findings
}

export function checkDocFreshness(rootPath = process.cwd()) {
  const normalizedRoot = resolve(rootPath)
  const docs = getInScopeDocs(normalizedRoot)
  const docsProject = docs.find((doc) => doc.docPath === "docs/PROJECT.md")

  const findings = {
    missingProjects: findMissingProjects(
      normalizedRoot,
      docsProject?.content ?? "",
    ),
    dependencyClaims: findDependencyClaimDrift(normalizedRoot, docs),
    stalePaths: findStalePathReferences(normalizedRoot, docs),
  }

  return {
    ok:
      findings.missingProjects.length === 0 &&
      findings.dependencyClaims.length === 0 &&
      findings.stalePaths.length === 0,
    findings,
  }
}

export function formatDocFreshnessReport(result) {
  if (result.ok) {
    return "Documentation freshness check passed."
  }

  const lines = ["Documentation freshness check failed.", ""]

  if (result.findings.missingProjects.length > 0) {
    lines.push("Missing completed PROJs:")
    for (const finding of result.findings.missingProjects) {
      lines.push(
        `- ${finding.docPath}: ${finding.projId} is missing even though ${finding.progressPath} contains ${finding.logCount} progress log(s).`,
      )
    }
    lines.push("")
  }

  if (result.findings.dependencyClaims.length > 0) {
    lines.push("Dependency claim drift:")
    for (const finding of result.findings.dependencyClaims) {
      if (finding.manifestPath && finding.actualVersion) {
        lines.push(
          `- ${finding.docPath}:${finding.lineNumber} claims ${finding.claim}, but ${finding.manifestPath} declares ${finding.packageName}@${finding.actualVersion}.`,
        )
        continue
      }

      lines.push(
        `- ${finding.docPath}:${finding.lineNumber} claims ${finding.claim}, but ${finding.packageName} has no approved manifest entry in package.json or apps/*/package.json.`,
      )
    }
    lines.push("")
  }

  if (result.findings.stalePaths.length > 0) {
    lines.push("Stale active path references:")
    for (const finding of result.findings.stalePaths) {
      lines.push(
        `- ${finding.docPath}:${finding.lineNumber} references ${finding.referencedPath}, but that path does not exist in the repo.`,
      )
    }
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function runCli() {
  const rootPath = process.argv[2] ? resolve(process.argv[2]) : process.cwd()
  const result = checkDocFreshness(rootPath)
  const report = formatDocFreshnessReport(result)

  if (result.ok) {
    console.log(report)
    process.exit(0)
  }

  console.error(report)
  process.exit(1)
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli()
}
