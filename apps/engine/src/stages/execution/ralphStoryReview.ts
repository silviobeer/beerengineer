import { spawnSync } from "node:child_process"
import { stagePresent } from "../../core/stagePresentation.js"
import { readWorkspaceConfig } from "../../core/workspaces.js"
import type { RunLlmConfig } from "../../llm/registry.js"
import { shouldIgnoreTransientUntrackedPath } from "../../llm/hosted/execution/coderHarness.js"
import { runStoryReviewTools } from "../../review/registry.js"
import type { CodeRabbitResult, SonarCloudResult } from "../../review/types.js"
import type { Finding, StoryExecutionContext, StoryImplementationArtifact, StoryReviewArtifact } from "../../types.js"
import { readJsonIfExists, requireStoryBranch } from "./ralphRuntimeShared.js"

type GitBaseline = {
  headSha: string | null
  untrackedFiles: string[]
}

type StoryReviewRun = {
  designSystemFindings: Finding[]
  coderabbitFindings: Finding[]
  sonarFindings: Finding[]
  combinedFindings: Finding[]
  designSystem: StoryReviewArtifact["gate"]["designSystem"]
  coderabbit: StoryReviewArtifact["gate"]["coderabbit"]
  sonar: StoryReviewArtifact["gate"]["sonar"]
  failedBecause: string[]
  outcome: StoryReviewArtifact["outcome"]
}

export async function runStoryReview(input: {
  reviewCycle: number
  storyContext: StoryExecutionContext
  artifactsDir: string
  baselinePath: string
  llm?: RunLlmConfig
  implementation: StoryImplementationArtifact
}): Promise<StoryReviewRun> {
  if (!input.llm) {
    return summarizeReviewResult(await runStoryReviewTools({
      workspaceRoot: input.storyContext.worktreeRoot ?? process.cwd(),
      artifactsDir: input.artifactsDir,
      baselineSha: null,
      storyBranch: requireStoryBranch(input.storyContext),
      baseBranch: input.storyContext.item.baseBranch,
      changedFiles: input.implementation.changedFiles,
      storyId: input.storyContext.story.id,
      reviewCycle: input.reviewCycle,
      reviewPolicy: {
        coderabbit: { enabled: false },
        sonarcloud: { enabled: false },
      },
      forceFake: true,
    }))
  }

  const reviewWorkspaceRoot = input.storyContext.worktreeRoot ?? input.llm.workspaceRoot
  const configRoot = input.storyContext.primaryWorkspaceRoot ?? input.llm.workspaceRoot
  const workspaceConfig = await readWorkspaceConfig(configRoot)
  const reviewPolicy = workspaceConfig?.reviewPolicy ?? {
    coderabbit: { enabled: false },
    sonarcloud: workspaceConfig?.sonar ?? { enabled: false },
  }

  return summarizeReviewResult(await runStoryReviewTools({
    workspaceRoot: reviewWorkspaceRoot,
    artifactsDir: input.artifactsDir,
    baselineSha: await readBaselineSha(input.baselinePath),
    storyBranch: requireStoryBranch(input.storyContext),
    baseBranch: reviewPolicy.sonarcloud.baseBranch ?? input.storyContext.item.baseBranch,
    changedFiles: await collectReviewChangedFiles(reviewWorkspaceRoot, input.baselinePath),
    storyId: input.storyContext.story.id,
    reviewCycle: input.reviewCycle,
    reviewPolicy,
  }))
}

export function buildReviewArtifact(
  storyContext: StoryExecutionContext,
  reviewCycle: number,
  result: StoryReviewRun,
): StoryReviewArtifact {
  const reviewers = [
    { source: "design-system" as const, findings: result.designSystemFindings },
    { source: "coderabbit" as const, findings: result.coderabbitFindings },
    { source: "sonarqube" as const, findings: result.sonarFindings },
  ].map(reviewer => ({
    source: reviewer.source,
    status: reviewer.findings.length > 0 ? "revise" as const : "pass" as const,
    findings: reviewer.findings.map(finding => ({
      severity: finding.severity,
      message: finding.message,
    })),
  }))

  return {
    story: { id: storyContext.story.id, title: storyContext.story.title },
    reviewCycle,
    reviewers,
    gate: {
      status: result.outcome.startsWith("pass") ? "pass" : "fail",
      failedBecause: result.failedBecause,
      designSystem: result.designSystem,
      coderabbit: result.coderabbit,
      sonar: result.sonar,
    },
    outcome: result.outcome,
    feedbackSummary: buildFeedbackSummary(result),
  }
}

export function printReviewResult(result: StoryReviewRun): void {
  result.combinedFindings.forEach(finding => stagePresent.finding(finding.source, finding.severity, finding.message))
  if (result.failedBecause.length === 0) {
    stagePresent.ok("Story gate open: CodeRabbit and SonarQube are within target.")
    if (result.outcome !== "pass") stagePresent.warn(`Review passed with warnings: ${result.outcome}`)
    return
  }
  result.failedBecause.forEach(reason => stagePresent.warn(`Gate blocked: ${reason}`))
}

function summarizeReviewResult(review: Awaited<ReturnType<typeof runStoryReviewTools>>): StoryReviewRun {
  const designSystemFindings = review.designSystem.findings
  const coderabbitFindings = review.coderabbit.findings
  const sonarFindings = review.sonarcloud.findings
  const designSystem = designSystemGate(review.designSystem)
  const coderabbit = coderabbitGate(review.coderabbit)
  const sonar = sonarGate(review.sonarcloud)
  const failedBecause = reviewFailureReasons(designSystem, coderabbit, sonar)
  return {
    designSystemFindings,
    coderabbitFindings,
    sonarFindings,
    combinedFindings: dedupeFindings([...designSystemFindings, ...coderabbitFindings, ...sonarFindings]),
    designSystem,
    coderabbit,
    sonar,
    failedBecause,
    outcome: reviewOutcome(designSystem, coderabbit, sonar, failedBecause),
  }
}

function buildFeedbackSummary(result: StoryReviewRun): string[] {
  const summary = [
    toolStatusLine("design-system", result.designSystem),
    toolStatusLine("coderabbit", result.coderabbit),
    toolStatusLine("sonar", result.sonar),
  ]
  for (const reason of result.failedBecause) summary.push(`[gate] ${reason}`)
  for (const finding of result.combinedFindings) summary.push(`[${finding.source}] ${finding.message}`)
  return summary
}

function toolStatusLine(
  tool: "design-system" | "coderabbit" | "sonar",
  value: StoryReviewArtifact["gate"]["designSystem"] | StoryReviewArtifact["gate"]["coderabbit"] | StoryReviewArtifact["gate"]["sonar"],
): string {
  if (value.status === "ran") return `[tool-status] ${tool}: ran (${value.passed ? "pass" : "fail"})`
  return `[tool-status] ${tool}: ${value.status} (${value.reason})`
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter(finding => {
    const key = `${finding.source}|${finding.severity}|${finding.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return { ok: result.status === 0, stdout: result.stdout?.trim() ?? "" }
}

function listUntrackedFiles(workspaceRoot: string): string[] {
  const result = runGit(["ls-files", "--others", "--exclude-standard"], workspaceRoot)
  if (!result.ok) return []
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

async function readBaselineSha(path: string): Promise<string | null> {
  const baseline = await readJsonIfExists<GitBaseline>(path)
  return baseline?.headSha ?? null
}

async function collectReviewChangedFiles(workspaceRoot: string, baselinePath: string): Promise<string[]> {
  const baseline = await readJsonIfExists<GitBaseline>(baselinePath)
  const tracked = baseline?.headSha
    ? runGit(["diff", "--name-only", baseline.headSha], workspaceRoot).stdout
    : runGit(["status", "--porcelain"], workspaceRoot).stdout
        .split(/\r?\n/)
        .map(line => {
          const path = line.slice(3).trim()
          const arrow = path.lastIndexOf(" -> ")
          return arrow >= 0 ? path.slice(arrow + 4).trim() : path
        })
        .filter(Boolean)
        .join("\n")
  const baselineUntracked = new Set(baseline?.untrackedFiles ?? [])
  const untrackedDelta = listUntrackedFiles(workspaceRoot).filter(
    file => !baselineUntracked.has(file) && !shouldIgnoreTransientUntrackedPath(file),
  )
  return Array.from(new Set([...tracked.split(/\r?\n/).map(line => line.trim()).filter(Boolean), ...untrackedDelta]))
    .sort((left, right) => left.localeCompare(right))
}

function designSystemGate(
  result: { status: "ran" | "skipped"; passed: boolean; summary?: string },
): StoryReviewArtifact["gate"]["designSystem"] {
  if (result.status === "ran") return { status: "ran", passed: result.passed }
  return { status: "skipped", reason: result.summary ?? "design-system-skipped" }
}

function coderabbitGate(result: CodeRabbitResult): StoryReviewArtifact["gate"]["coderabbit"] {
  switch (result.status) {
    case "ran":
      return {
        status: "ran",
        passed: !result.findings.some(finding => finding.severity === "critical" || finding.severity === "high"),
      }
    case "skipped":
      return { status: "skipped", reason: result.reason ?? "coderabbit-skipped" }
    case "failed":
      return { status: "failed", reason: result.reason ?? "coderabbit-failed", exitCode: result.exitCode }
  }
}

function sonarGate(result: SonarCloudResult): StoryReviewArtifact["gate"]["sonar"] {
  switch (result.status) {
    case "ran":
      return { status: "ran", passed: result.passed, conditions: result.conditions }
    case "skipped":
      return { status: "skipped", reason: result.reason ?? "sonar-skipped" }
    case "failed":
      return { status: "failed", reason: result.reason ?? "sonar-failed", exitCode: result.exitCode }
  }
}

function reviewOutcome(
  designSystem: StoryReviewArtifact["gate"]["designSystem"],
  coderabbit: StoryReviewArtifact["gate"]["coderabbit"],
  sonar: StoryReviewArtifact["gate"]["sonar"],
  failedBecause: string[],
): StoryReviewArtifact["outcome"] {
  const ranTools = [designSystem, coderabbit, sonar].filter(tool => tool.status === "ran")
  const skippedTools = [designSystem, coderabbit, sonar].filter(tool => tool.status === "skipped")
  const failedTools = [coderabbit, sonar].filter(tool => tool.status === "failed")
  if (failedBecause.length > 0) return "revise"
  if (ranTools.length === 0 && skippedTools.length === 3) return "pass-unreviewed"
  if (ranTools.length === 0 && failedTools.length === 2) return "pass-tool-failure"
  if (skippedTools.length > 0 || failedTools.length > 0) return "pass-partial"
  return "pass"
}

function reviewFailureReasons(
  designSystem: ReturnType<typeof designSystemGate>,
  coderabbit: ReturnType<typeof coderabbitGate>,
  sonar: ReturnType<typeof sonarGate>,
): string[] {
  const failedBecause: string[] = []
  if (designSystem.status === "ran" && !designSystem.passed) {
    failedBecause.push("Design-system gate found hardcoded colors or rounded styles.")
  }
  if (coderabbit.status === "ran" && !coderabbit.passed) {
    failedBecause.push("CodeRabbit still reports critical or high-severity review issues.")
  }
  if (sonar.status === "ran" && !sonar.passed) {
    const failedMetrics = (sonar.conditions ?? [])
      .filter(condition => condition.status === "error")
      .map(condition => `${condition.metric} ${condition.actual}/${condition.threshold}`)
    failedBecause.push(
      failedMetrics.length > 0
        ? `SonarQube quality gate failed: ${failedMetrics.join(", ")}.`
        : "SonarQube quality gate failed.",
    )
  }
  return failedBecause
}
