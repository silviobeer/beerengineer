export type DocFreshnessFinding = {
  docPath: string
  ruleId: string
  message: string
  sortKey: readonly [docPath: string, ruleId: string, subject: string]
  evidence?: Readonly<Record<string, string | number>>
}

function compareSortKeySegment(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function sortDocFreshnessFindings(findings: readonly DocFreshnessFinding[]): DocFreshnessFinding[] {
  return [...findings].sort((left, right) => {
    for (let index = 0; index < left.sortKey.length; index += 1) {
      const segment = compareSortKeySegment(left.sortKey[index], right.sortKey[index])
      if (segment !== 0) return segment
    }
    return compareSortKeySegment(left.message, right.message)
  })
}

export function renderDocFreshnessReport(findings: readonly DocFreshnessFinding[]): string {
  const sortedFindings = sortDocFreshnessFindings(findings)
  if (sortedFindings.length === 0) {
    return "Documentation freshness check passed."
  }

  const lines = ["Documentation freshness check failed.", ""]
  for (const finding of sortedFindings) {
    lines.push(`- ${finding.docPath} [${finding.ruleId}] ${finding.message}`)
  }

  return lines.join("\n")
}
