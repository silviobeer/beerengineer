import type { DocFreshnessScope } from "../scope.js"
import {
  defineFreshnessRule,
  FRESHNESS_RULE_IDS,
  type DependencyClaimParityFinding,
} from "./index.js"

const FENCED_CODE_DELIMITER_PATTERN = /^\s*```/
const CLAIM_TOKEN_PATTERN = /[^\s`]+/g
const VERSION_PATTERN = /^[~^]?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)?$/
const CURRENT_DEPENDENCY_CONTEXT_KEYWORDS = [
  "active",
  "canonical",
  "current",
  "depends on",
  "dependencies",
  "dependency",
  "installed",
  "package",
  "packages",
  "pinned",
  "requires",
  "ships with",
  "tooling",
  "use",
  "uses",
] as const
const NON_CURRENT_DEPENDENCY_CONTEXT_KEYWORDS = [
  "example",
  "examples",
  "for example",
  "historical",
  "migration",
  "migrated",
  "previous",
  "removed",
  "sample",
  "samples",
  "snippet",
  "snippets",
  "used to",
] as const

type ManifestClaim = {
  manifestPath: string
  version: string
}

type DependencyClaim = {
  packageName: string
  claimedVersion: string
}

function isCurrentDependencyClaim(line: string, previousContextLine = ""): boolean {
  if (containsKeyword(line, NON_CURRENT_DEPENDENCY_CONTEXT_KEYWORDS)) return false
  if (containsKeyword(line, CURRENT_DEPENDENCY_CONTEXT_KEYWORDS)) return true
  if (!previousContextLine) return false
  if (containsKeyword(previousContextLine, NON_CURRENT_DEPENDENCY_CONTEXT_KEYWORDS)) return false
  return containsKeyword(previousContextLine, CURRENT_DEPENDENCY_CONTEXT_KEYWORDS)
}

function buildManifestEntries(scope: DocFreshnessScope): Map<string, ManifestClaim[]> {
  const entries = new Map<string, ManifestClaim[]>()

  for (const packageManifest of scope.packageManifests) {
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      const dependencyMap = packageManifest.manifest[field] ?? {}
      for (const [packageName, version] of Object.entries(dependencyMap)) {
        const existing = entries.get(packageName) ?? []
        existing.push({
          manifestPath: packageManifest.manifestPath,
          version,
        })
        entries.set(packageName, existing)
      }
    }
  }

  return entries
}

function collectDependencyClaims(line: string): DependencyClaim[] {
  const claims: DependencyClaim[] = []
  let match = CLAIM_TOKEN_PATTERN.exec(line)
  while (match) {
    const claim = parseDependencyClaim(match[0] ?? "")
    if (claim) claims.push(claim)
    match = CLAIM_TOKEN_PATTERN.exec(line)
  }
  CLAIM_TOKEN_PATTERN.lastIndex = 0
  return claims
}

function parseDependencyClaim(token: string): DependencyClaim | null {
  const trimmedToken = token.replace(/^[('"`]+|[)"'`,.;:]+$/g, "")
  const versionSeparatorIndex = trimmedToken.lastIndexOf("@")
  if (versionSeparatorIndex <= 0) return null

  const packageName = trimmedToken.slice(0, versionSeparatorIndex)
  const claimedVersion = trimmedToken.slice(versionSeparatorIndex + 1)
  if (!isValidPackageName(packageName)) return null
  if (!VERSION_PATTERN.test(claimedVersion)) return null

  return { packageName, claimedVersion }
}

function isValidPackageName(packageName: string): boolean {
  if (packageName.startsWith("@")) {
    const segments = packageName.slice(1).split("/")
    return segments.length === 2 && segments.every((segment) => isPackageSegment(segment))
  }

  return isPackageSegment(packageName)
}

function isPackageSegment(segment: string): boolean {
  return segment.length > 0 && /^[a-z0-9][a-z0-9._-]*$/i.test(segment)
}

function collectDocFindings(
  docPath: string,
  lines: readonly string[],
  manifestEntries: Map<string, ManifestClaim[]>,
): DependencyClaimParityFinding[] {
  const findings: DependencyClaimParityFinding[] = []
  let insideFencedCodeBlock = false
  let previousContextLine = ""

  for (const [index, line] of lines.entries()) {
    if (FENCED_CODE_DELIMITER_PATTERN.test(line)) {
      insideFencedCodeBlock = !insideFencedCodeBlock
      continue
    }

    if (insideFencedCodeBlock) continue
    if (!isCurrentDependencyClaim(line, previousContextLine)) {
      previousContextLine = updateContextLine(previousContextLine, line)
      continue
    }

    for (const claim of collectDependencyClaims(line)) {
      const manifestClaims = manifestEntries.get(claim.packageName)
      if (!manifestClaims || manifestClaims.length === 0) {
        findings.push({
          ruleId: FRESHNESS_RULE_IDS.dependencyClaimParity,
          docPath,
          lineNumber: index + 1,
          packageName: claim.packageName,
          claimedVersion: claim.claimedVersion,
          manifestPath: null,
          actualVersion: null,
        })
        continue
      }

      if (manifestClaims.some((entry) => entry.version === claim.claimedVersion)) continue

      findings.push({
        ruleId: FRESHNESS_RULE_IDS.dependencyClaimParity,
        docPath,
        lineNumber: index + 1,
        packageName: claim.packageName,
        claimedVersion: claim.claimedVersion,
        manifestPath: manifestClaims[0]?.manifestPath ?? null,
        actualVersion: manifestClaims[0]?.version ?? null,
      })
    }

    previousContextLine = updateContextLine(previousContextLine, line)
  }

  return findings
}

function updateContextLine(previousContextLine: string, line: string): string {
  return line.trim().length > 0 ? line : previousContextLine
}

function containsKeyword(
  line: string,
  keywords: readonly string[],
): boolean {
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

export const dependencyClaimParityRule = defineFreshnessRule({
  id: FRESHNESS_RULE_IDS.dependencyClaimParity,
  evaluate(scope) {
    const manifestEntries = buildManifestEntries(scope)
    return scope.docs.flatMap((doc) =>
      collectDocFindings(doc.docPath, doc.content.split(/\r?\n/), manifestEntries),
    )
  },
})
