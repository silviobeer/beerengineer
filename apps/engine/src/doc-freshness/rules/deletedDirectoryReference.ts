import {
  resolveScopedDirectoryReference,
  scopedDirectoryExists,
} from "../scope.js"
import {
  defineFreshnessRule,
  FRESHNESS_RULE_IDS,
  type DeletedDirectoryReferenceFinding,
} from "./index.js"

const INLINE_CODE_PATTERN = /`([^`\n]+)`/g
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)\s]+)\)/g
const ACTIVE_PATH_CONTEXT_KEYWORDS = [
  "active",
  "canonical",
  "current",
  "directory",
  "directories",
  "docs",
  "entry",
  "home",
  "lives",
  "live",
  "located",
  "look",
  "open",
  "path",
  "paths",
  "read",
  "reference",
  "references",
  "route",
  "routes",
  "source",
  "sources",
  "start at",
  "stored",
  "structure",
  "under",
  "use",
  "uses",
] as const
const HISTORICAL_CONTEXT_KEYWORDS = [
  "archive",
  "archived",
  "former",
  "formerly",
  "historical",
  "moved",
  "no longer active",
  "no longer current",
  "no longer exists",
  "previous",
  "removed",
  "retired",
  "used to",
  "was a historical mistake",
  "wrong location",
] as const

function isHistoricalContext(line: string): boolean {
  return containsKeyword(line, HISTORICAL_CONTEXT_KEYWORDS)
}

function collectPathCandidates(line: string): string[] {
  const candidates = new Set<string>()

  collectMatches(INLINE_CODE_PATTERN, line, candidates, 1)
  collectMatches(MARKDOWN_LINK_PATTERN, line, candidates, 1)

  const leadingPath = readLeadingPathCandidate(line)
  if (leadingPath) candidates.add(leadingPath)

  return [...candidates]
}

function isCurrentPathContext(line: string): boolean {
  if (containsKeyword(line, ACTIVE_PATH_CONTEXT_KEYWORDS)) return true
  return readLeadingPathCandidate(line) !== null
}

function collectMatches(
  pattern: RegExp,
  line: string,
  candidates: Set<string>,
  groupIndex: number,
): void {
  let match = pattern.exec(line)
  while (match) {
    const candidate = match[groupIndex]
    if (candidate) candidates.add(candidate)
    match = pattern.exec(line)
  }
  pattern.lastIndex = 0
}

function readLeadingPathCandidate(line: string): string | null {
  const trimmedLine = line.trimStart()
  if (trimmedLine.length === 0) return null

  const firstToken = trimmedLine.split(/\s+/, 1)[0] ?? ""
  const remainder = trimmedLine.slice(firstToken.length)
  if (remainder.length > 0 && !remainder.startsWith(" -") && !remainder.startsWith(" —")) {
    return null
  }

  return firstToken
}

function collectLineFindings(
  rootPath: string,
  docPath: string,
  line: string,
  lineNumber: number,
): DeletedDirectoryReferenceFinding[] {
  if (isHistoricalContext(line)) return []
  if (!isCurrentPathContext(line)) return []

  const findings: DeletedDirectoryReferenceFinding[] = []
  for (const candidate of collectPathCandidates(line)) {
    const resolved = resolveScopedDirectoryReference(rootPath, docPath, candidate)
    if (!resolved) continue
    if (scopedDirectoryExists(rootPath, docPath, candidate) !== false) continue

    findings.push({
      ruleId: FRESHNESS_RULE_IDS.deletedDirectoryReference,
      docPath,
      lineNumber,
      referencedPath: resolved.referencedPath,
    })
  }

  return findings
}

function containsKeyword(line: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => matchesKeyword(line, keyword))
}

function matchesKeyword(line: string, keyword: string): boolean {
  const normalizedLine = line.toLowerCase()
  const normalizedKeyword = keyword.toLowerCase()

  if (normalizedKeyword.includes(" ")) {
    return normalizedLine.includes(normalizedKeyword)
  }

  let startIndex = normalizedLine.indexOf(normalizedKeyword)
  while (startIndex !== -1) {
    const endIndex = startIndex + normalizedKeyword.length
    if (isBoundary(normalizedLine, startIndex - 1) && isBoundary(normalizedLine, endIndex)) {
      return true
    }
    startIndex = normalizedLine.indexOf(normalizedKeyword, startIndex + 1)
  }

  return false
}

function isBoundary(line: string, index: number): boolean {
  if (index < 0 || index >= line.length) return true
  return !/[a-z0-9_]/i.test(line[index] ?? "")
}

export const deletedDirectoryReferenceRule = defineFreshnessRule({
  id: FRESHNESS_RULE_IDS.deletedDirectoryReference,
  evaluate(scope) {
    return scope.docs.flatMap((doc) =>
      doc.content
        .split(/\r?\n/)
        .flatMap((line, index) =>
          collectLineFindings(scope.rootPath, doc.docPath, line, index + 1),
        ),
    )
  },
})
