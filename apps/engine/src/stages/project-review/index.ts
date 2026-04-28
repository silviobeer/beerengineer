import { spawnSync } from "node:child_process"
import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { branchNameProject } from "../../core/branchNames.js"
import { createProjectReviewReview, createProjectReviewStage, type RunLlmConfig } from "../../llm/registry.js"
import { shouldIgnoreTransientUntrackedPath } from "../../llm/hosted/execution/coderHarness.js"
import { renderPlanSummary } from "../../render/artifactDigests.js"
import { renderProjectReviewMarkdown } from "../../render/projectReview.js"
import type { ProjectReviewArtifact, ProjectReviewFinding, WithExecution } from "../../types.js"
import type { ProjectReviewRepoEvidence, ProjectReviewState } from "./types.js"

type SeverityCounts = Partial<Record<ProjectReviewFinding["severity"], number>>

function findingsBySeverity(artifact: ProjectReviewArtifact): SeverityCounts {
  return artifact.findings.reduce<SeverityCounts>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1
    return counts
  }, {})
}

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

function sanitizeExecutionSummaries(executionSummaries: WithExecution["executionSummaries"]): WithExecution["executionSummaries"] {
  return executionSummaries.map(wave => ({
    ...wave,
    storiesMerged: wave.storiesMerged.map(story => ({
      ...story,
      filesIntegrated: story.filesIntegrated.filter(path => !shouldIgnoreTransientUntrackedPath(path)),
    })),
  }))
}

function isTextReviewTarget(path: string): boolean {
  return /\.(md|txt|html?|css|js|jsx|ts|tsx|json|ya?ml|sh)$/i.test(path)
}

function reviewTargetPaths(executionSummaries: WithExecution["executionSummaries"]): string[] {
  const fromExecution = executionSummaries
    .flatMap(wave => wave.storiesMerged.flatMap(story => story.filesIntegrated))
    .filter(path => !shouldIgnoreTransientUntrackedPath(path))
    .filter(path => isTextReviewTarget(path))
  const explicit = [
    "docs/QA-RESULTS.md",
    "public/index.html",
    "README.md",
    "SMOKE-TEST-SETUP.md",
    "package.json",
    "package-lock.json",
  ]
  return Array.from(new Set([...explicit, ...fromExecution])).sort((left, right) => left.localeCompare(right))
}

function readBranchFile(workspaceRoot: string, branch: string, path: string): string | null {
  const result = runGit(workspaceRoot, ["show", `${branch}:${path}`])
  return result.ok ? result.stdout : null
}

export function collectProjectReviewRepoEvidence(ctx: WithExecution): ProjectReviewRepoEvidence | undefined {
  if (!ctx.workspaceRoot) return undefined

  const branch = branchNameProject(ctx, ctx.project.id)
  const branchCheck = runGit(ctx.workspaceRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
  if (!branchCheck.ok) return undefined

  const tracked = runGit(ctx.workspaceRoot, ["ls-tree", "-r", "--name-only", branch])
  const trackedFiles = tracked.ok
    ? tracked.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : []

  const checkedFiles = reviewTargetPaths(ctx.executionSummaries).map(path => {
    const content = readBranchFile(ctx.workspaceRoot!, branch, path)
    return {
      path,
      exists: content !== null,
      excerpt: content === null ? undefined : content.slice(0, 2400),
    }
  })

  return {
    branch,
    trackedFileCount: trackedFiles.length,
    trackedFilesSample: trackedFiles.slice(0, 200),
    checkedFiles,
  }
}

export async function projectReview(ctx: WithExecution, llm?: RunLlmConfig): Promise<ProjectReviewArtifact> {
  stagePresent.header(`project-review — ${ctx.project.name}`)
  const sanitizedExecutionSummaries = sanitizeExecutionSummaries(ctx.executionSummaries)
  const repoEvidence = collectProjectReviewRepoEvidence({ ...ctx, executionSummaries: sanitizedExecutionSummaries })

  const { result } = await runStage({
    stageId: "project-review",
    stageAgentLabel: "Project-Review-Verifier",
    reviewerLabel: "Project-Review-Gate",
    workspaceId: ctx.workspaceId,
    workspaceRoot: ctx.workspaceRoot!,
    runId: ctx.runId,
    createInitialState: (): ProjectReviewState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      architecture: ctx.architecture,
      planSummary: renderPlanSummary(ctx.plan),
      executionSummaries: sanitizedExecutionSummaries,
      repoEvidence,
      revisionCount: 0,
    }),
    stageAgent: createProjectReviewStage(ctx.project, llm),
    reviewer: createProjectReviewReview(llm),
    askUser: async () => "",
    async persistArtifacts(run, artifact) {
      return [
        {
          kind: "json",
          label: "Project Review JSON",
          fileName: "project-review.json",
          content: JSON.stringify(artifact, null, 2),
        },
        {
          kind: "md",
          label: "Project Review Markdown",
          fileName: "project-review.md",
          content: renderProjectReviewMarkdown(artifact),
        },
        summaryArtifactFile(
          "project-review",
          stageSummary(run, [
            `Status: ${artifact.overallStatus}`,
            `Residual findings: ${artifact.findings.length}`,
          ]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      const severityCounts = findingsBySeverity(artifact)
      stagePresent.ok(`Project review approved with status "${artifact.overallStatus}".`)
      stagePresent.chat("Project-Review", artifact.summary)
      for (const finding of artifact.findings) {
        stagePresent.finding(finding.source, finding.severity, `${finding.category}: ${finding.message}`)
      }
      if (artifact.findings.length > 0) {
        stagePresent.dim(
          `Residual findings by severity: critical=${severityCounts.critical ?? 0}, high=${severityCounts.high ?? 0}, medium=${severityCounts.medium ?? 0}, low=${severityCounts.low ?? 0}`,
        )
      }
      printStageCompletion(run, "project-review")
      return artifact
    },
    maxReviews: 3,
  })

  return result
}
