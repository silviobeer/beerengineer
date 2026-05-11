import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import {
  renderDocFreshnessReport,
  type DocFreshnessFinding,
} from "./reporter.js"
import {
  resolveDocFreshnessScope,
} from "./scope.js"
import {
  type DependencyClaimParityFinding,
  type DeletedDirectoryReferenceFinding,
  type MissingCompletedProjFinding,
  orderedFreshnessRules,
} from "./rules/index.js"
import { completedProjParityRule } from "./rules/completedProjParity.js"
import { dependencyClaimParityRule } from "./rules/dependencyClaimParity.js"
import { deletedDirectoryReferenceRule } from "./rules/deletedDirectoryReference.js"

type MaybePromise<T> = T | Promise<T>

type DocFreshnessWriter = {
  write(chunk: string): void
}

export type DocFreshnessRunnerOptions = {
  rootPath?: string
  collectFindings?: () => MaybePromise<readonly DocFreshnessFinding[]>
  stdout?: DocFreshnessWriter
  stderr?: DocFreshnessWriter
}

export async function runDocFreshnessReport(options: DocFreshnessRunnerOptions = {}): Promise<number> {
  const findings = [...await (
    options.collectFindings?.() ?? collectDocFreshnessFindings(options.rootPath)
  )]
  const report = renderDocFreshnessReport(findings)
  const writer = findings.length === 0
    ? (options.stdout ?? process.stdout)
    : (options.stderr ?? process.stderr)

  writer.write(`${report}\n`)
  return findings.length === 0 ? 0 : 1
}

export async function main(): Promise<void> {
  const rootPath = process.argv[2] ? resolve(process.argv[2]) : process.cwd()
  const exitCode = await runDocFreshnessReport({ rootPath })
  process.exit(exitCode)
}

export function collectDocFreshnessFindings(rootPath = process.cwd()): DocFreshnessFinding[] {
  const scope = resolveDocFreshnessScope(rootPath)
  const registry = {
    completedProjParity: completedProjParityRule,
    dependencyClaimParity: dependencyClaimParityRule,
    deletedDirectoryReference: deletedDirectoryReferenceRule,
  }

  return orderedFreshnessRules(registry).flatMap((rule) =>
    rule.evaluate(scope).map((finding) => toReportFinding(finding)),
  )
}

function toReportFinding(
  finding:
    | MissingCompletedProjFinding
    | DependencyClaimParityFinding
    | DeletedDirectoryReferenceFinding,
): DocFreshnessFinding {
  if (finding.ruleId === "completed-proj-parity") {
    return {
      docPath: finding.docPath,
      ruleId: finding.ruleId,
      message:
        `${finding.projId} is missing even though ${finding.progressPath} contains ${finding.evidenceCount} progress markdown file(s).`,
      sortKey: [finding.docPath, finding.ruleId, finding.projId],
      evidence: {
        projId: finding.projId,
        progressPath: finding.progressPath,
        evidenceCount: finding.evidenceCount,
      },
    }
  }

  if (finding.ruleId === "dependency-claim-parity") {
    const subject = `${String(finding.lineNumber ?? 0).padStart(6, "0")}:${finding.packageName}`
    return {
      docPath: finding.docPath,
      ruleId: finding.ruleId,
      message: finding.manifestPath && finding.actualVersion
        ? `claims ${finding.packageName}@${finding.claimedVersion}, but ${finding.manifestPath} declares ${finding.packageName}@${finding.actualVersion}.`
        : `claims ${finding.packageName}@${finding.claimedVersion}, but ${finding.packageName} has no approved manifest entry in package.json or apps/*/package.json.`,
      sortKey: [finding.docPath, finding.ruleId, subject],
      evidence: {
        packageName: finding.packageName,
        claimedVersion: finding.claimedVersion,
        lineNumber: finding.lineNumber ?? 0,
      },
    }
  }

  return {
    docPath: finding.docPath,
    ruleId: finding.ruleId,
    message: `references ${finding.referencedPath}, but that directory does not exist in the repo.`,
    sortKey: [
      finding.docPath,
      finding.ruleId,
      `${String(finding.lineNumber ?? 0).padStart(6, "0")}:${finding.referencedPath}`,
    ],
    evidence: {
      referencedPath: finding.referencedPath,
      lineNumber: finding.lineNumber ?? 0,
    },
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  await main()
}
