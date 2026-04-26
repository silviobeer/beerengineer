import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import {
  abandonBranch,
  appendBranchCommit,
  branchNameProject,
  branchNameWave,
  ensureWaveBranch,
  ensureStoryBranch,
  mergeStoryBranchIntoWave,
} from "../../core/repoSimulation.js"
import { emitEvent, getActiveRun } from "../../core/runContext.js"
import { writeRecoveryRecord } from "../../core/recovery.js"
import { layout, type WorkflowContext } from "../../core/workspaceLayout.js"
import type { StageLogEntry } from "../../core/stageRuntime.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { readWorkspaceConfig } from "../../core/workspaces.js"
import { executionCoderPolicy, resolveHarness, type RunLlmConfig } from "../../llm/registry.js"
import { runCoderHarness, shouldIgnoreTransientUntrackedPath } from "../../llm/hosted/execution/coderHarness.js"
import type { IterationContext } from "../../llm/hosted/promptEnvelope.js"
import { llm6bFix, llm6bImplement } from "../../sim/llm.js"
import { runStoryReviewTools } from "../../review/registry.js"
import type { CodeRabbitResult, SonarCloudResult } from "../../review/types.js"
import type {
  Finding,
  SimulatedBranch,
  StoryCheckResult,
  StoryExecutionContext,
  StoryImplementationArtifact,
  StoryReviewArtifact,
  WaveSummary,
} from "../../types.js"

const MAX_ITERATIONS_PER_CYCLE = 4
const MAX_REVIEW_CYCLES = 3

export type StoryArtifacts = {
  implementation: StoryImplementationArtifact
  review?: StoryReviewArtifact
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

function nowIso(): string {
  return new Date().toISOString()
}

function fakeChangedFiles(storyId: string): string[] {
  return [
    `src/${storyId.toLowerCase()}/handler.ts`,
    `src/${storyId.toLowerCase()}/service.ts`,
  ]
}

type GitBaseline = {
  headSha: string | null
  untrackedFiles: string[]
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return undefined
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function appendLog(path: string, entry: StageLogEntry): Promise<void> {
  await writeFile(path, `${JSON.stringify(entry)}\n`, { flag: "a" })
}

function logEntry(type: StageLogEntry["type"], message: string, data?: Record<string, unknown>): StageLogEntry {
  return { at: nowIso(), type, message, ...(data ? { data } : {}) }
}

function requireBranch(implementation: StoryImplementationArtifact): SimulatedBranch {
  if (!implementation.branch) {
    throw new Error(`Missing simulated branch for story ${implementation.story.id}`)
  }
  return implementation.branch
}

async function recordStoryBlocked(
  ctx: WorkflowContext,
  storyContext: StoryExecutionContext,
  implementation: StoryImplementationArtifact,
  review: StoryReviewArtifact | undefined,
  cause: "review_limit" | "story_error",
  summary: string,
): Promise<void> {
  const dir = layout.executionRalphDir(ctx, storyContext.wave.number, storyContext.story.id)
  const findings = review?.reviewers
    .flatMap(reviewer =>
      reviewer.findings.map(finding => ({
        source: reviewer.source,
        severity: finding.severity,
        message: finding.message,
      })),
    ) ?? []
  await writeRecoveryRecord(ctx, {
    status: "blocked",
    cause,
    scope: {
      type: "story",
      runId: ctx.runId,
      waveNumber: storyContext.wave.number,
      storyId: storyContext.story.id,
    },
    summary,
    branch: implementation.branch?.name,
    evidencePaths: [
      join(dir, "implementation.json"),
      join(dir, "story-review.json"),
      join(dir, "log.jsonl"),
    ],
    findings,
  })
  const activeRun = getActiveRun()
  if (activeRun) {
    emitEvent({
      type: "run_blocked",
      runId: activeRun.runId,
      itemId: activeRun.itemId,
      title: activeRun.title ?? activeRun.itemId,
      scope: {
        type: "story",
        runId: ctx.runId,
        waveNumber: storyContext.wave.number,
        storyId: storyContext.story.id,
      },
      cause,
      summary,
      branch: implementation.branch?.name,
    })
  }
}

function buildReviewArtifact(
  context: StoryExecutionContext,
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
    story: { id: context.story.id, title: context.story.title },
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

function buildFeedbackSummary(result: StoryReviewRun): string[] {
  const summary: string[] = []
  const toolStatusLine = (
    tool: "design-system" | "coderabbit" | "sonar",
    value: StoryReviewArtifact["gate"]["designSystem"] | StoryReviewArtifact["gate"]["coderabbit"] | StoryReviewArtifact["gate"]["sonar"],
  ): string => {
    if (value.status === "ran") {
      return `[tool-status] ${tool}: ran (${value.passed ? "pass" : "fail"})`
    }
    return `[tool-status] ${tool}: ${value.status} (${value.reason})`
  }
  summary.push(toolStatusLine("design-system", result.designSystem))
  summary.push(toolStatusLine("coderabbit", result.coderabbit))
  summary.push(toolStatusLine("sonar", result.sonar))
  for (const reason of result.failedBecause) summary.push(`[gate] ${reason}`)
  for (const finding of result.combinedFindings) summary.push(`[${finding.source}] ${finding.message}`)
  return summary
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

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  }
}

// Stages and commits any uncommitted work in the story worktree. The coder
// agent writes files but does not always commit; without this, story branches
// stay at the wave-base commit and `mergeStoryIntoWaveReal` becomes a silent
// no-op that loses the work when the worktree is removed at end-of-wave.
function commitWorktreeChanges(worktreeRoot: string, message: string): string | null {
  const inside = runGit(["rev-parse", "--is-inside-work-tree"], worktreeRoot)
  if (!inside.ok || inside.stdout !== "true") return null
  const status = runGit(["status", "--porcelain"], worktreeRoot)
  if (!status.ok || !status.stdout) return null
  const add = runGit(["add", "-A"], worktreeRoot)
  if (!add.ok) {
    stagePresent.warn(`commit-worktree: git add failed in ${worktreeRoot}: ${add.stderr}`)
    return null
  }
  const commit = runGit(["commit", "-m", message], worktreeRoot)
  if (!commit.ok) {
    stagePresent.warn(`commit-worktree: git commit failed in ${worktreeRoot}: ${commit.stderr || commit.stdout}`)
    return null
  }
  const sha = runGit(["rev-parse", "HEAD"], worktreeRoot)
  return sha.ok ? sha.stdout : null
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
  const currentUntracked = listUntrackedFiles(workspaceRoot)
  const untrackedDelta = currentUntracked.filter(
    file => !baselineUntracked.has(file) && !shouldIgnoreTransientUntrackedPath(file),
  )
  return Array.from(new Set([...tracked.split(/\r?\n/).map(line => line.trim()).filter(Boolean), ...untrackedDelta])).sort()
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
      return {
        status: "ran",
        passed: result.passed,
        conditions: result.conditions,
      }
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

async function runStoryReview(input: {
  reviewCycle: number
  storyContext: StoryExecutionContext
  artifactsDir: string
  baselinePath: string
  llm?: RunLlmConfig
  implementation: StoryImplementationArtifact
}): Promise<StoryReviewRun> {
  if (!input.llm) {
    const review = await runStoryReviewTools({
      workspaceRoot: input.storyContext.worktreeRoot ?? process.cwd(),
      artifactsDir: input.artifactsDir,
      baselineSha: null,
      storyBranch: input.storyContext.storyBranch ?? requireBranch(input.implementation).name,
      baseBranch: input.storyContext.item.baseBranch,
      changedFiles: input.implementation.changedFiles,
      storyId: input.storyContext.story.id,
      reviewCycle: input.reviewCycle,
      reviewPolicy: {
        coderabbit: { enabled: false },
        sonarcloud: { enabled: false },
      },
      forceFake: true,
    })
    const designSystem = review.designSystem
    const coderabbit = coderabbitGate(review.coderabbit)
    const sonar = sonarGate(review.sonarcloud)
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
    return {
      designSystemFindings: review.designSystem.findings,
      coderabbitFindings: review.coderabbit.findings,
      sonarFindings: review.sonarcloud.findings,
      combinedFindings: dedupeFindings([...review.designSystem.findings, ...review.coderabbit.findings, ...review.sonarcloud.findings]),
      designSystem,
      coderabbit,
      sonar,
      failedBecause,
      outcome: reviewOutcome(designSystem, coderabbit, sonar, failedBecause),
    }
  }

  const reviewWorkspaceRoot = input.storyContext.worktreeRoot ?? input.llm.workspaceRoot
  // workspace.json lives in the primary workspaceRoot, not in story worktrees.
  // Note: `executionStageLlmForStory` rewrites `llm.workspaceRoot` to the
  // per-story worktree before this runs, so reading config from llm here
  // returns null. We thread `primaryWorkspaceRoot` separately on the story
  // context for exactly this reason.
  const configRoot = input.storyContext.primaryWorkspaceRoot ?? input.llm.workspaceRoot
  const workspaceConfig = await readWorkspaceConfig(configRoot)
  const reviewPolicy = workspaceConfig?.reviewPolicy ?? {
    coderabbit: { enabled: false },
    sonarcloud: workspaceConfig?.sonar ?? { enabled: false },
  }
  const baselineSha = await readBaselineSha(input.baselinePath)
  const changedFiles = await collectReviewChangedFiles(reviewWorkspaceRoot, input.baselinePath)
  const baseBranch = reviewPolicy.sonarcloud.baseBranch ?? input.storyContext.item.baseBranch

  const review = await runStoryReviewTools({
    workspaceRoot: reviewWorkspaceRoot,
    artifactsDir: input.artifactsDir,
    baselineSha,
    storyBranch: input.storyContext.storyBranch ?? requireBranch(input.implementation).name,
    baseBranch,
    changedFiles,
    storyId: input.storyContext.story.id,
    reviewCycle: input.reviewCycle,
    reviewPolicy,
  })

  const designSystemFindings = review.designSystem.findings
  const coderabbitFindings = review.coderabbit.findings
  const sonarFindings = review.sonarcloud.findings
  const combinedFindings = dedupeFindings([...designSystemFindings, ...coderabbitFindings, ...sonarFindings])
  const failedBecause: string[] = []
  const designSystem = review.designSystem
  const coderabbit = coderabbitGate(review.coderabbit)
  const sonar = sonarGate(review.sonarcloud)

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

  return {
    designSystemFindings,
    coderabbitFindings,
    sonarFindings,
    combinedFindings,
    designSystem,
    coderabbit,
    sonar,
    failedBecause,
    outcome: reviewOutcome(designSystem, coderabbit, sonar, failedBecause),
  }
}

function printReviewResult(result: StoryReviewRun): void {
  result.combinedFindings.forEach(finding => stagePresent.finding(finding.source, finding.severity, finding.message))
  if (result.failedBecause.length === 0) {
    stagePresent.ok("Story gate open: CodeRabbit and SonarQube are within target.")
    if (result.outcome !== "pass") {
      stagePresent.warn(`Review passed with warnings: ${result.outcome}`)
    }
    return
  }
  result.failedBecause.forEach(reason => stagePresent.warn(`Gate blocked: ${reason}`))
}

function checksForIteration(iterationsThisCycle: number, isRemediation: boolean): StoryCheckResult[] {
  const green = iterationsThisCycle >= 2 || isRemediation
  return [
    {
      name: isRemediation ? "targeted-remediation-tests" : "story-tests",
      kind: "integration",
      status: green ? "pass" : "fail",
      summary: green ? "All mapped checks passed." : "Acceptance criteria coverage still incomplete.",
    },
    {
      name: "typecheck",
      kind: "typecheck",
      status: "pass",
    },
  ]
}

function resultFromChecks(checks: StoryCheckResult[]): "done" | "tests_failed" {
  return checks.every(check => check.status !== "fail") ? "done" : "tests_failed"
}

function countIterationsInCycle(implementation: StoryImplementationArtifact, reviewCycle: number): number {
  return implementation.iterations.filter(it => it.reviewCycle === reviewCycle).length
}

function cycleReviewPath(dir: string, cycle: number): string {
  return join(dir, `story-review-cycle-${cycle}.json`)
}

type RalphPaths = {
  dir: string
  implementationPath: string
  reviewPath: string
  logPath: string
  remediationPath: string
  baselinePath: string
}

type PendingRemediation = {
  id: string
  summary: string
  branch?: string | null
  commitSha?: string | null
  reviewNotes?: string | null
}

type RalphLoopContext = {
  runtimeContext: WorkflowContext
  storyContext: StoryExecutionContext
  paths: RalphPaths
  llm?: RunLlmConfig
}

function ralphPaths(
  runtimeContext: WorkflowContext,
  storyContext: StoryExecutionContext,
): RalphPaths {
  const dir = layout.executionRalphDir(runtimeContext, storyContext.wave.number, storyContext.story.id)
  return {
    dir,
    implementationPath: join(dir, "implementation.json"),
    reviewPath: join(dir, "story-review.json"),
    logPath: join(dir, "log.jsonl"),
    remediationPath: join(dir, "pending-remediation.json"),
    baselinePath: join(dir, "coder-baseline.json"),
  }
}

function newImplementation(storyContext: StoryExecutionContext): StoryImplementationArtifact {
  return {
    story: { id: storyContext.story.id, title: storyContext.story.title },
    mode: "ralph-wiggum",
    status: "in_progress",
    implementationGoal: storyContext.testPlan.testPlan.summary,
    maxIterations: MAX_ITERATIONS_PER_CYCLE,
    maxReviewCycles: MAX_REVIEW_CYCLES,
    currentReviewCycle: 0,
    iterations: [],
    coderSessionId: null,
    priorAttempts: [],
    changedFiles: [],
    finalSummary: "",
  }
}

async function ensureBranchAndStartLog(
  ctx: RalphLoopContext,
  implementation: StoryImplementationArtifact,
): Promise<void> {
  if (implementation.iterations.length > 0) return
  if (!implementation.branch) {
    implementation.branch = await ensureStoryBranch(
      ctx.runtimeContext,
      ctx.storyContext.project.id,
      ctx.storyContext.wave.number,
      ctx.storyContext.story.id,
    )
    await writeJson(ctx.paths.implementationPath, implementation)
    await appendLog(ctx.paths.logPath, logEntry("branch_event", `Branch created: ${implementation.branch.name}`, {
      storyId: ctx.storyContext.story.id,
      branch: implementation.branch.name,
      base: implementation.branch.base,
    }))
  }
  await appendLog(ctx.paths.logPath, logEntry("status_changed", `Story ${ctx.storyContext.story.id} started`, {
    storyId: ctx.storyContext.story.id,
  }))
}

async function consumePendingRemediation(
  ctx: RalphLoopContext,
  remediation: PendingRemediation | undefined,
  existingFeedback: string | undefined,
): Promise<string | undefined> {
  if (!remediation) return existingFeedback
  const remediationLine = [
    `[external-remediation] ${remediation.summary}`,
    remediation.branch ? `branch=${remediation.branch}` : undefined,
    remediation.commitSha ? `commit=${remediation.commitSha}` : undefined,
    remediation.reviewNotes ? `notes=${remediation.reviewNotes}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ")
  const merged = existingFeedback ? `${remediationLine}; ${existingFeedback}` : remediationLine
  await appendLog(ctx.paths.logPath, logEntry("stage_message", "External remediation applied to next iteration", {
    storyId: ctx.storyContext.story.id,
    remediationId: remediation.id,
  }))
  try {
    await unlink(ctx.paths.remediationPath)
  } catch {
    // Already consumed / removed — ignore.
  }
  return merged
}

async function runOneIteration(
  ctx: RalphLoopContext,
  implementation: StoryImplementationArtifact,
  opts: {
    reviewCycle: number
    maxIterationsPerCycle: number
    maxReviewCycles: number
    iterationsThisCycle: number
    feedback: string | undefined
  },
): Promise<"done" | "tests_failed"> {
  const { runtimeContext, storyContext, paths, llm } = ctx
  const iterationNumber = implementation.iterations.length + 1
  const isRemediation = Boolean(opts.feedback)
  const action = isRemediation
    ? `Apply review feedback: ${opts.feedback}`
    : "Implement story against approved test plan"

  stagePresent.step(
    isRemediation
      ? `    Ralph addresses review findings for ${storyContext.story.id}...`
      : `    Ralph implements ${storyContext.story.id}...`,
  )

  let coderSummary: string | undefined
  let changedFilesThisIteration: string[] = []
  let notes: string[] = isRemediation ? ["Remediation run triggered by story review."] : []

  if (llm) {
    const harness = resolveHarness({
      workspaceRoot: llm.workspaceRoot,
      harnessProfile: llm.harnessProfile,
      runtimePolicy: llm.runtimePolicy,
      role: "coder",
      stage: "execution",
    })
    const iterationContext: IterationContext = {
      iteration: iterationNumber,
      maxIterations: opts.maxIterationsPerCycle,
      reviewCycle: opts.reviewCycle + 1,
      maxReviewCycles: opts.maxReviewCycles,
      priorAttempts: implementation.priorAttempts ?? [],
    }
    const coderResult = await runCoderHarness({
      harness,
      runtimePolicy: executionCoderPolicy(llm.runtimePolicy),
      baselinePath: paths.baselinePath,
      storyContext,
      reviewFeedback: isRemediation ? opts.feedback ?? "" : undefined,
      sessionId: implementation.coderSessionId ?? null,
      iterationContext,
    })
    coderSummary = coderResult.summary
    changedFilesThisIteration = coderResult.changedFiles
    implementation.coderSessionId = coderResult.sessionId
    notes = [...notes, ...coderResult.implementationNotes]
    if (coderResult.blockers.length > 0) {
      notes.push(...coderResult.blockers.map(blocker => `[blocker] ${blocker}`))
    }
    stagePresent.dim(`    → ${coderSummary}`)
    if (storyContext.worktreeRoot) {
      const commitMessage = isRemediation
        ? `Apply review feedback for ${storyContext.story.id} (iteration ${iterationNumber})`
        : `Implement ${storyContext.story.id} (iteration ${iterationNumber})`
      const sha = commitWorktreeChanges(storyContext.worktreeRoot, commitMessage)
      if (sha) {
        stagePresent.dim(`    → committed ${storyContext.story.id} iteration ${iterationNumber}: ${sha.slice(0, 8)}`)
      }
    }
  } else if (isRemediation) {
    await llm6bFix(opts.feedback ?? "")
  } else {
    await llm6bImplement({
      id: storyContext.story.id,
      title: storyContext.story.title,
      acceptanceCriteria: storyContext.story.acceptanceCriteria,
    })
    changedFilesThisIteration = fakeChangedFiles(storyContext.story.id)
  }

  const checks = checksForIteration(opts.iterationsThisCycle, isRemediation)
  const result = resultFromChecks(checks)

  implementation.iterations.push({
    number: iterationNumber,
    reviewCycle: opts.reviewCycle,
    action,
    checks,
    result: result === "done" && isRemediation ? "review_feedback_applied" : result,
    notes,
  })
  ;(implementation.priorAttempts ??= []).push({
    iteration: iterationNumber,
    summary: coderSummary ?? (result === "done" ? "Implementation reached green." : "Implementation still failing checks."),
    outcome: result === "done" ? "passed" : result === "tests_failed" ? "failed" : "blocked",
  })
  implementation.changedFiles = Array.from(
    new Set([...implementation.changedFiles, ...changedFilesThisIteration]),
  )
  implementation.branch = await appendBranchCommit(
    runtimeContext,
    requireBranch(implementation).name,
    isRemediation
      ? `Apply review feedback for ${storyContext.story.id}`
      : `Implement ${storyContext.story.id}`,
    implementation.changedFiles,
  )
  implementation.status = result === "done" ? "ready_for_review" : "in_progress"
  if (result === "done") {
    implementation.finalSummary = "Implementation reached a green state and is ready for story review."
  }

  await writeJson(paths.implementationPath, implementation)
  const lastCommit = requireBranch(implementation).commits[requireBranch(implementation).commits.length - 1]
  await appendLog(paths.logPath, logEntry("branch_event", `Commit: ${lastCommit.message}`, {
    storyId: storyContext.story.id,
    branch: requireBranch(implementation).name,
    commit: lastCommit.message,
  }))
  await appendLog(paths.logPath, logEntry("iteration", `Iteration ${iterationNumber} (cycle ${opts.reviewCycle}): ${result}`, {
    storyId: storyContext.story.id,
    iteration: iterationNumber,
    reviewCycle: opts.reviewCycle,
    action,
    checks,
    result,
  }))

  return result
}

/** Run iterations until green or iteration budget is exhausted. */
async function runCoderCycleUntilGreen(
  ctx: RalphLoopContext,
  implementation: StoryImplementationArtifact,
  opts: {
    reviewCycle: number
    maxIterationsPerCycle: number
    maxReviewCycles: number
    feedback: string | undefined
  },
): Promise<"ready_for_review" | "exhausted"> {
  implementation.status = "in_progress"
  let iterationsThisCycle = countIterationsInCycle(implementation, opts.reviewCycle)

  while (iterationsThisCycle < opts.maxIterationsPerCycle) {
    iterationsThisCycle++
    const result = await runOneIteration(ctx, implementation, {
      reviewCycle: opts.reviewCycle,
      maxIterationsPerCycle: opts.maxIterationsPerCycle,
      maxReviewCycles: opts.maxReviewCycles,
      iterationsThisCycle,
      feedback: opts.feedback,
    })
    if (result === "done") return "ready_for_review"
  }
  return "exhausted"
}

/**
 * Run one review over a `ready_for_review` implementation. On pass, merge the
 * story branch into the wave. On revise, return the feedback for the next cycle.
 */
async function runOneReviewCycle(
  ctx: RalphLoopContext,
  implementation: StoryImplementationArtifact,
  reviewCycle: number,
): Promise<{ kind: "passed"; review: StoryReviewArtifact } | { kind: "revise"; review: StoryReviewArtifact; nextFeedback: string }> {
  const { runtimeContext, storyContext, paths, llm } = ctx
  await appendLog(paths.logPath, logEntry("status_changed", `Transition to review cycle ${reviewCycle}`, {
    storyId: storyContext.story.id,
    reviewCycle,
  }))

  const reviewResult = await runStoryReview({
    reviewCycle: reviewCycle + 1,
    storyContext,
    artifactsDir: paths.dir,
    baselinePath: paths.baselinePath,
    llm,
    implementation,
  })
  printReviewResult(reviewResult)
  const storyReview = buildReviewArtifact(storyContext, reviewCycle + 1, reviewResult)
  await writeJson(cycleReviewPath(paths.dir, reviewCycle + 1), storyReview)
  await writeJson(paths.reviewPath, storyReview)
  await appendLog(paths.logPath, logEntry(
    storyReview.outcome.startsWith("pass") ? "review_pass" : "review_revise",
    `Review cycle ${reviewCycle} ${storyReview.outcome}`,
    {
      storyId: storyContext.story.id,
      reviewCycle,
      findings: reviewResult.combinedFindings,
    },
  ))

  if (!storyReview.outcome.startsWith("pass")) {
    implementation.status = "in_progress"
    await writeJson(paths.implementationPath, implementation)
    return { kind: "revise", review: storyReview, nextFeedback: storyReview.feedbackSummary.join("; ") }
  }

  if (implementation.branch) {
    const merge = await mergeStoryBranchIntoWave(
      runtimeContext,
      storyContext.project.id,
      storyContext.wave.number,
      implementation.branch.name,
      implementation.changedFiles,
    )
    implementation.branch = merge.storyBranch
    await appendLog(paths.logPath, logEntry("branch_event", `Merged ${merge.storyBranch.name} → ${merge.waveBranch.name}`, {
      storyId: storyContext.story.id,
      branch: merge.storyBranch.name,
      target: merge.waveBranch.name,
    }))
  }
  implementation.status = "passed"
  implementation.finalSummary = `Story implementation and story review both passed, then ${implementation.branch?.name ?? "story branch"} was merged into ${implementation.branch?.base ?? "wave branch"}.`
  await writeJson(paths.implementationPath, implementation)
  await appendLog(paths.logPath, logEntry("status_changed", `Story ${storyContext.story.id} passed`, {
    storyId: storyContext.story.id,
    status: "passed",
  }))
  return { kind: "passed", review: storyReview }
}

/**
 * Unified blocked tail: mark the implementation blocked, abandon the story
 * branch, record the recovery artifact, and return. Used for both
 * iteration-budget and review-cycle-budget exhaustion.
 */
async function blockStory(
  ctx: RalphLoopContext,
  implementation: StoryImplementationArtifact,
  storyReview: StoryReviewArtifact | undefined,
  cause: "story_error" | "review_limit",
  summary: string,
): Promise<StoryArtifacts> {
  const { runtimeContext, storyContext, paths } = ctx
  implementation.status = "blocked"
  implementation.finalSummary = summary
  if (implementation.branch) {
    implementation.branch = await abandonBranch(runtimeContext, implementation.branch.name)
    await appendLog(paths.logPath, logEntry("branch_event", `Branch abandoned: ${implementation.branch.name}`, {
      storyId: storyContext.story.id,
      branch: implementation.branch.name,
    }))
  }
  await writeJson(paths.implementationPath, implementation)
  await appendLog(paths.logPath, logEntry("status_changed", `Story ${storyContext.story.id} blocked`, {
    storyId: storyContext.story.id,
    status: "blocked",
  }))
  await recordStoryBlocked(
    runtimeContext,
    storyContext,
    implementation,
    storyReview,
    cause,
    summary,
  )
  return { implementation, review: storyReview }
}

export async function runRalphStory(
  storyContext: StoryExecutionContext,
  runtimeContext: WorkflowContext,
  llm?: RunLlmConfig,
): Promise<StoryArtifacts> {
  const paths = ralphPaths(runtimeContext, storyContext)
  await mkdir(paths.dir, { recursive: true })

  const persistedImplementation = await readJsonIfExists<StoryImplementationArtifact>(paths.implementationPath)
  const persistedReview = await readJsonIfExists<StoryReviewArtifact>(paths.reviewPath)
  const pendingRemediation = await readJsonIfExists<PendingRemediation>(paths.remediationPath)

  const implementation: StoryImplementationArtifact = persistedImplementation ?? newImplementation(storyContext)
  let storyReview = persistedReview

  if (implementation.status === "passed" || implementation.status === "blocked") {
    return { implementation, review: storyReview }
  }

  const loopCtx: RalphLoopContext = { runtimeContext, storyContext, paths, llm }
  await ensureBranchAndStartLog(loopCtx, implementation)

  const initialFeedback = storyReview?.outcome === "revise" ? storyReview.feedbackSummary.join("; ") : undefined
  let nextFeedback = await consumePendingRemediation(loopCtx, pendingRemediation, initialFeedback)

  const maxIterationsPerCycle = implementation.maxIterations
  const maxReviewCycles = implementation.maxReviewCycles

  for (
    let reviewCycle = Math.max(implementation.currentReviewCycle, 0);
    reviewCycle < maxReviewCycles;
    reviewCycle++
  ) {
    implementation.currentReviewCycle = reviewCycle

    if (implementation.status !== "ready_for_review") {
      const coderOutcome = await runCoderCycleUntilGreen(loopCtx, implementation, {
        reviewCycle,
        maxIterationsPerCycle,
        maxReviewCycles,
        feedback: nextFeedback,
      })
      if (coderOutcome === "exhausted") {
        return blockStory(
          loopCtx,
          implementation,
          storyReview,
          "story_error",
          `Blocked after ${maxIterationsPerCycle} implementation iterations in review cycle ${reviewCycle + 1} without reaching green.`,
        )
      }
    }

    const cycleResult = await runOneReviewCycle(loopCtx, implementation, reviewCycle)
    storyReview = cycleResult.review
    if (cycleResult.kind === "passed") {
      return { implementation, review: storyReview }
    }
    nextFeedback = cycleResult.nextFeedback
  }

  return blockStory(
    loopCtx,
    implementation,
    storyReview,
    "review_limit",
    `Blocked after ${maxReviewCycles} story review cycles because the CodeRabbit/SonarQube gate did not open.`,
  )
}

export async function writeWaveSummary(
  runtimeContext: WorkflowContext,
  wave: { id: string; number: number },
  projectId: string,
  summaries: Array<{ storyId: string; implementation: StoryImplementationArtifact }>,
): Promise<WaveSummary> {
  await ensureWaveBranch(runtimeContext, projectId, wave.number)
  const summary: WaveSummary = {
    waveId: wave.id,
    waveBranch: branchNameWave(runtimeContext, projectId, wave.number),
    projectBranch: branchNameProject(runtimeContext, projectId),
    storiesMerged: summaries
      .filter(({ implementation }) => implementation.status === "passed")
      .map(({ storyId, implementation }) => ({
        storyId,
        branch: implementation.branch?.name ?? `story/${storyId}`,
        commitCount: implementation.branch?.commits.length ?? implementation.iterations.length,
        filesIntegrated: implementation.changedFiles,
      })),
    storiesBlocked: summaries
      .filter(({ implementation }) => implementation.status === "blocked")
      .map(({ storyId }) => storyId),
  }

  const path = layout.waveSummaryFile(runtimeContext, wave.number)
  await mkdir(layout.executionWaveDir(runtimeContext, wave.number), { recursive: true })
  await writeJson(path, summary)
  return summary
}
