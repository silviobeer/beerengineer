import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parallelReview } from "../../core/parallelReview.js"
import {
  abandonBranch,
  appendBranchCommit,
  ensureStoryBranch,
  mergeStoryBranchIntoProject,
} from "../../core/repoSimulation.js"
import { layout, type WorkflowContext } from "../../core/workspaceLayout.js"
import type { StageLogEntry } from "../../core/stageRuntime.js"
import { print } from "../../print.js"
import { crReview, llm6bFix, llm6bImplement, sonarReview } from "../../sim/llm.js"
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
  coderabbitFindings: Finding[]
  sonarFindings: Finding[]
  combinedFindings: Finding[]
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

function buildReviewArtifact(
  context: StoryExecutionContext,
  reviewCycle: number,
  result: StoryReviewRun,
): StoryReviewArtifact {
  const reviewers = [
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
      status: result.outcome === "pass" ? "pass" : "fail",
      failedBecause: result.failedBecause,
      sonar: result.sonar,
    },
    outcome: result.outcome,
    feedbackSummary: buildFeedbackSummary(result),
  }
}

function buildFeedbackSummary(result: StoryReviewRun): string[] {
  const summary: string[] = []
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

async function runStoryReview(reviewCycle: number, storyId: string): Promise<StoryReviewRun> {
  const [coderabbitResult, sonarResultRaw] = await parallelReview(
    `Parallel Review ${storyId}: CodeRabbit + SonarQube...`,
    [
      () => crReview(reviewCycle, storyId) as Promise<unknown>,
      () => sonarReview(reviewCycle, storyId) as Promise<unknown>,
    ],
  )
  const coderabbitFindings = coderabbitResult as Finding[]
  const sonarResult = sonarResultRaw as Awaited<ReturnType<typeof sonarReview>>

  const combinedFindings = dedupeFindings([...coderabbitFindings, ...sonarResult.findings])
  const failedBecause: string[] = []

  if (coderabbitFindings.some(finding => finding.severity === "critical" || finding.severity === "high")) {
    failedBecause.push("CodeRabbit still reports critical or high-severity review issues.")
  }

  if (!sonarResult.passed) {
    const failedMetrics = sonarResult.conditions
      .filter(condition => condition.status === "error")
      .map(condition => `${condition.metric} ${condition.actual}/${condition.threshold}`)
    failedBecause.push(
      failedMetrics.length > 0
        ? `SonarQube quality gate failed: ${failedMetrics.join(", ")}.`
        : "SonarQube quality gate failed.",
    )
  }

  return {
    coderabbitFindings,
    sonarFindings: sonarResult.findings,
    combinedFindings,
    sonar: {
      passed: sonarResult.passed,
      conditions: sonarResult.conditions,
    },
    failedBecause,
    outcome: failedBecause.length === 0 ? "pass" : "revise",
  }
}

function printReviewResult(result: StoryReviewRun): void {
  result.combinedFindings.forEach(finding => print.finding(finding.source, finding.severity, finding.message))
  if (result.failedBecause.length === 0) {
    print.ok("Story gate offen: CodeRabbit und SonarQube sind im Zielbereich.")
    return
  }
  result.failedBecause.forEach(reason => print.warn(`Gate blockiert: ${reason}`))
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

export async function runRalphStory(
  storyContext: StoryExecutionContext,
  runtimeContext: WorkflowContext,
): Promise<StoryArtifacts> {
  const dir = layout.executionRalphDir(runtimeContext, storyContext.wave.number, storyContext.story.id)
  await mkdir(dir, { recursive: true })

  const implementationPath = join(dir, "implementation.json")
  const reviewPath = join(dir, "story-review.json")
  const logPath = join(dir, "log.jsonl")

  const persistedImplementation = await readJsonIfExists<StoryImplementationArtifact>(implementationPath)
  const persistedReview = await readJsonIfExists<StoryReviewArtifact>(reviewPath)

  const implementation: StoryImplementationArtifact = persistedImplementation ?? {
    story: { id: storyContext.story.id, title: storyContext.story.title },
    mode: "ralph-wiggum",
    status: "in_progress",
    implementationGoal: storyContext.testPlan.testPlan.summary,
    maxIterations: MAX_ITERATIONS_PER_CYCLE,
    maxReviewCycles: MAX_REVIEW_CYCLES,
    currentReviewCycle: 0,
    iterations: [],
    changedFiles: [],
    finalSummary: "",
  }

  const maxIterationsPerCycle = implementation.maxIterations
  const maxReviewCycles = implementation.maxReviewCycles

  let storyReview = persistedReview

  if (implementation.status === "passed" || implementation.status === "blocked") {
    return { implementation, review: storyReview }
  }

  if (implementation.iterations.length === 0) {
    if (!implementation.branch) {
      implementation.branch = await ensureStoryBranch(
        runtimeContext,
        storyContext.project.id,
        storyContext.story.id,
      )
      await writeJson(implementationPath, implementation)
      await appendLog(logPath, logEntry("branch_event", `Branch created: ${implementation.branch.name}`, {
        storyId: storyContext.story.id,
        branch: implementation.branch.name,
        base: implementation.branch.base,
      }))
    }
    await appendLog(logPath, logEntry("status_changed", `Story ${storyContext.story.id} started`, {
      storyId: storyContext.story.id,
    }))
  }

  let nextFeedback = storyReview?.outcome === "revise" ? storyReview.feedbackSummary.join("; ") : undefined

  for (
    let reviewCycle = Math.max(implementation.currentReviewCycle, 0);
    reviewCycle < maxReviewCycles;
    reviewCycle++
  ) {
    implementation.currentReviewCycle = reviewCycle

    if (implementation.status !== "ready_for_review") {
      implementation.status = "in_progress"
      let iterationsThisCycle = countIterationsInCycle(implementation, reviewCycle)

      while (iterationsThisCycle < maxIterationsPerCycle) {
        iterationsThisCycle++
        const iterationNumber = implementation.iterations.length + 1
        const isRemediation = Boolean(nextFeedback)
        const action = isRemediation
          ? `Apply review feedback: ${nextFeedback}`
          : "Implement story against approved test plan"

        if (isRemediation) {
          print.step(`    Ralph behebt Review-Findings fuer ${storyContext.story.id}...`)
          await llm6bFix(nextFeedback ?? "")
        } else {
          print.step(`    Ralph implementiert ${storyContext.story.id}...`)
          await llm6bImplement({
            id: storyContext.story.id,
            title: storyContext.story.title,
            acceptanceCriteria: storyContext.story.acceptanceCriteria,
          })
        }

        const checks = checksForIteration(iterationsThisCycle, isRemediation)
        const result = resultFromChecks(checks)

        implementation.iterations.push({
          number: iterationNumber,
          reviewCycle,
          action,
          checks,
          result: result === "done" && isRemediation ? "review_feedback_applied" : result,
          notes: isRemediation ? ["Remediation run triggered by story review."] : [],
        })
        implementation.changedFiles = Array.from(
          new Set([...implementation.changedFiles, ...fakeChangedFiles(storyContext.story.id)]),
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

        await writeJson(implementationPath, implementation)
        const lastCommit = requireBranch(implementation).commits[requireBranch(implementation).commits.length - 1]
        await appendLog(logPath, logEntry("branch_event", `Commit: ${lastCommit.message}`, {
          storyId: storyContext.story.id,
          branch: requireBranch(implementation).name,
          commit: lastCommit.message,
        }))
        await appendLog(logPath, logEntry("iteration", `Iteration ${iterationNumber} (cycle ${reviewCycle}): ${result}`, {
          storyId: storyContext.story.id,
          iteration: iterationNumber,
          reviewCycle,
          action,
          checks,
          result,
        }))

        if (result === "done") break
      }

      if (implementation.status !== "ready_for_review") {
        implementation.status = "blocked"
        implementation.finalSummary = `Blocked after ${maxIterationsPerCycle} implementation iterations in review cycle ${reviewCycle + 1} without reaching green.`
        if (implementation.branch) {
          implementation.branch = await abandonBranch(runtimeContext, implementation.branch.name)
          await appendLog(logPath, logEntry("branch_event", `Branch abandoned: ${implementation.branch.name}`, {
            storyId: storyContext.story.id,
            branch: implementation.branch.name,
          }))
        }
        await writeJson(implementationPath, implementation)
        await appendLog(logPath, logEntry("status_changed", `Story ${storyContext.story.id} blocked`, {
          storyId: storyContext.story.id,
          status: "blocked",
        }))
        return { implementation, review: storyReview }
      }
    }

    await appendLog(logPath, logEntry("status_changed", `Transition to review cycle ${reviewCycle}`, {
      storyId: storyContext.story.id,
      reviewCycle,
    }))

    const reviewResult = await runStoryReview(reviewCycle + 1, storyContext.story.id)
    printReviewResult(reviewResult)
    storyReview = buildReviewArtifact(storyContext, reviewCycle + 1, reviewResult)
    await writeJson(cycleReviewPath(dir, reviewCycle + 1), storyReview)
    await writeJson(reviewPath, storyReview)
    await appendLog(logPath, logEntry(
      storyReview.outcome === "pass" ? "review_pass" : "review_revise",
      `Review cycle ${reviewCycle} ${storyReview.outcome}`,
      {
        storyId: storyContext.story.id,
        reviewCycle,
        findings: reviewResult.combinedFindings,
      },
    ))

    if (storyReview.outcome === "pass") {
      if (implementation.branch) {
        const merge = await mergeStoryBranchIntoProject(
          runtimeContext,
          storyContext.project.id,
          implementation.branch.name,
          implementation.changedFiles,
        )
        implementation.branch = merge.storyBranch
        await appendLog(logPath, logEntry("branch_event", `Merged ${merge.storyBranch.name} → ${merge.projectBranch.name}`, {
          storyId: storyContext.story.id,
          branch: merge.storyBranch.name,
          target: merge.projectBranch.name,
        }))
      }
      implementation.status = "passed"
      implementation.finalSummary = `Story implementation and story review both passed, then ${implementation.branch?.name ?? "story branch"} was merged into ${implementation.branch?.base ?? "project branch"}.`
      await writeJson(implementationPath, implementation)
      await appendLog(logPath, logEntry("status_changed", `Story ${storyContext.story.id} passed`, {
        storyId: storyContext.story.id,
        status: "passed",
      }))
      return { implementation, review: storyReview }
    }

    nextFeedback = storyReview.feedbackSummary.join("; ")
    implementation.status = "in_progress"
    await writeJson(implementationPath, implementation)
  }

  implementation.status = "blocked"
  implementation.finalSummary = `Blocked after ${maxReviewCycles} story review cycles because the CodeRabbit/SonarQube gate did not open.`
  if (implementation.branch) {
    implementation.branch = await abandonBranch(runtimeContext, implementation.branch.name)
    await appendLog(logPath, logEntry("branch_event", `Branch abandoned: ${implementation.branch.name}`, {
      storyId: storyContext.story.id,
      branch: implementation.branch.name,
    }))
  }
  await writeJson(implementationPath, implementation)
  await appendLog(logPath, logEntry("status_changed", `Story ${storyContext.story.id} blocked`, {
    storyId: storyContext.story.id,
    status: "blocked",
  }))
  return { implementation, review: storyReview }
}

export async function writeWaveSummary(
  runtimeContext: WorkflowContext,
  wave: { id: string; number: number },
  summaries: Array<{ storyId: string; implementation: StoryImplementationArtifact }>,
): Promise<WaveSummary> {
  const summary: WaveSummary = {
    waveId: wave.id,
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
