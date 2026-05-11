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
const LEADING_PATH_PATTERN =
  /^\s*(?<path>[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*(?:\/)?(?:[A-Za-z0-9._-]+)?)(?:\s+[—-]|\s*$)/
const ACTIVE_PATH_CONTEXT_PATTERN =
  /\b(active|canonical|current|directory|directories|docs|entry|home|lives|live|located|look|open|path|paths|read|reference|references|route|routes|source|sources|start at|stored|structure|under|use|uses)\b/i
const HISTORICAL_CONTEXT_PATTERN =
  /\b(archive|archived|former|formerly|historical|moved|no longer active|no longer current|no longer exists|previous|removed|retired|used to|was a historical mistake|wrong location)\b/i

function isHistoricalContext(line: string): boolean {
  return HISTORICAL_CONTEXT_PATTERN.test(line)
}

function collectPathCandidates(line: string): string[] {
  const candidates = new Set<string>()

  for (const match of line.matchAll(INLINE_CODE_PATTERN)) {
    candidates.add(match[1] ?? "")
  }

  for (const match of line.matchAll(MARKDOWN_LINK_PATTERN)) {
    candidates.add(match[1] ?? "")
  }

  const leadingPath = line.match(LEADING_PATH_PATTERN)?.groups?.path
  if (leadingPath) candidates.add(leadingPath)

  return [...candidates]
}

function isCurrentPathContext(line: string): boolean {
  if (ACTIVE_PATH_CONTEXT_PATTERN.test(line)) return true
  return LEADING_PATH_PATTERN.test(line)
}

export const deletedDirectoryReferenceRule = defineFreshnessRule({
  id: FRESHNESS_RULE_IDS.deletedDirectoryReference,
  evaluate(scope) {
    const findings: DeletedDirectoryReferenceFinding[] = []

    for (const doc of scope.docs) {
      const lines = doc.content.split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        if (isHistoricalContext(line)) continue
        if (!isCurrentPathContext(line)) continue

        for (const candidate of collectPathCandidates(line)) {
          const resolved = resolveScopedDirectoryReference(scope.rootPath, doc.docPath, candidate)
          if (!resolved) continue
          if (scopedDirectoryExists(scope.rootPath, doc.docPath, candidate) !== false) continue

          findings.push({
            ruleId: FRESHNESS_RULE_IDS.deletedDirectoryReference,
            docPath: doc.docPath,
            lineNumber: index + 1,
            referencedPath: resolved.referencedPath,
          })
        }
      }
    }

    return findings
  },
})
