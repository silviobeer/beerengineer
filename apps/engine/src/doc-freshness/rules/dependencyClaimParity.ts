import type { DocFreshnessScope } from "../scope.js"
import {
  defineFreshnessRule,
  FRESHNESS_RULE_IDS,
  type DependencyClaimParityFinding,
} from "./index.js"

const DEPENDENCY_CLAIM_PATTERN =
  /(?<![A-Za-z0-9_./-])(?<package>@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@(?<version>[\^~]?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]+)*)/gi
const FENCED_CODE_DELIMITER_PATTERN = /^\s*```/
const CURRENT_DEPENDENCY_CONTEXT_PATTERN =
  /\b(active|canonical|current|depends on|dependencies|dependency|installed|package|packages|pinned|requires|ships with|tooling|use|uses)\b/i
const NON_CURRENT_DEPENDENCY_CONTEXT_PATTERN =
  /\b(example|examples|for example|historical|migration|migrated|previous|removed|sample|samples|snippet|snippets|used to)\b/i

type ManifestClaim = {
  manifestPath: string
  version: string
}

function isCurrentDependencyClaim(line: string, previousContextLine = ""): boolean {
  if (NON_CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(line)) return false
  if (CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(line)) return true
  if (!previousContextLine) return false
  if (NON_CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(previousContextLine)) return false
  return CURRENT_DEPENDENCY_CONTEXT_PATTERN.test(previousContextLine)
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

export const dependencyClaimParityRule = defineFreshnessRule({
  id: FRESHNESS_RULE_IDS.dependencyClaimParity,
  evaluate(scope) {
    const manifestEntries = buildManifestEntries(scope)
    const findings: DependencyClaimParityFinding[] = []

    for (const doc of scope.docs) {
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
              ruleId: FRESHNESS_RULE_IDS.dependencyClaimParity,
              docPath: doc.docPath,
              lineNumber: index + 1,
              packageName,
              claimedVersion,
              manifestPath: null,
              actualVersion: null,
            })
            continue
          }

          if (manifestClaims.some((entry) => entry.version === claimedVersion)) continue

          findings.push({
            ruleId: FRESHNESS_RULE_IDS.dependencyClaimParity,
            docPath: doc.docPath,
            lineNumber: index + 1,
            packageName,
            claimedVersion,
            manifestPath: manifestClaims[0]?.manifestPath ?? null,
            actualVersion: manifestClaims[0]?.version ?? null,
          })
        }

        if (line.trim().length > 0) previousContextLine = line
      }
    }

    return findings
  },
})
