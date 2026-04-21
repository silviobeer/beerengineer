import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { createProjectReviewReview, createProjectReviewStage, defaultStageConfig } from "../../llm/registry.js"
import { print } from "../../print.js"
import { renderProjectReviewMarkdown } from "../../render/projectReview.js"
import type { ProjectReviewArtifact, ProjectReviewFinding, WithExecution } from "../../types.js"
import type { ProjectReviewState } from "./types.js"

type SeverityCounts = Partial<Record<ProjectReviewFinding["severity"], number>>

function findingsBySeverity(artifact: ProjectReviewArtifact): SeverityCounts {
  return artifact.findings.reduce<SeverityCounts>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1
    return counts
  }, {})
}

export async function projectReview(ctx: WithExecution): Promise<ProjectReviewArtifact> {
  print.header(`project-review — ${ctx.project.name}`)

  const { result } = await runStage({
    stageId: "project-review",
    stageAgentLabel: "Project-Review-Verifier",
    reviewerLabel: "Project-Review-Gate",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): ProjectReviewState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      architecture: ctx.architecture,
      implementationPlan: ctx.plan,
      executionSummaries: ctx.executionSummaries,
      revisionCount: 0,
    }),
    stageAgent: createProjectReviewStage(defaultStageConfig.stageAgent.provider, ctx.project),
    reviewer: createProjectReviewReview(defaultStageConfig.reviewer.provider),
    askUser: async () => "",
    showMessage: print.llm,
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
      print.ok(`Project review approved with status "${artifact.overallStatus}".`)
      print.llm("Project-Review", artifact.summary)
      for (const finding of artifact.findings) {
        print.finding(finding.source, finding.severity, `${finding.category}: ${finding.message}`)
      }
      if (artifact.findings.length > 0) {
        print.dim(
          `Residual findings by severity: critical=${severityCounts.critical ?? 0}, high=${severityCounts.high ?? 0}, medium=${severityCounts.medium ?? 0}, low=${severityCounts.low ?? 0}`,
        )
      }
      printStageCompletion(run, "project-review")
      return artifact
    },
    maxReviews: 2,
  })

  return result
}
