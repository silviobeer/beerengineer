import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { createPlanningReview, createPlanningStage, type RunLlmConfig } from "../../llm/registry.js"
import { renderPlanMarkdown } from "../../render/plan.js"
import type { ImplementationPlanArtifact, PRD, WithArchitecture } from "../../types.js"
import type { ReviewAgentAdapter, ReviewAgentResponse } from "../../core/adapters.js"
import type { PlanningState } from "./types.js"

function validatePlanStoryIds(artifact: ImplementationPlanArtifact, prd: PRD): string | null {
  const prdIds = new Set(prd.stories.map(s => s.id))
  const seen = new Set<string>()
  const issues: string[] = []
  const waves = artifact.plan?.waves
  if (!Array.isArray(waves)) {
    return `Plan is missing a \`plan.waves\` array. The artifact must include \`plan.waves: Array<{id,number,goal,stories,parallel,dependencies,exitCriteria}>\`; got \`${JSON.stringify(artifact.plan ?? null).slice(0, 200)}\`.`
  }
  if (waves.length === 0) {
    return `Plan contains zero waves. Every PRD story must belong to exactly one wave; emit at least one wave with the PRD stories assigned.`
  }
  const waveIds = new Set(waves.map(w => w.id))
  const waveIdsBefore = new Map<string, Set<string>>()
  const idsBefore = new Set<string>()
  for (const wave of waves) {
    waveIdsBefore.set(wave.id, new Set(idsBefore))
    idsBefore.add(wave.id)
  }
  for (const wave of waves) {
    const storyList = Array.isArray(wave.stories) ? wave.stories : []
    if (storyList.length === 0) {
      issues.push(`Wave ${wave.id ?? wave.number ?? "?"} has zero stories. Every wave must contain at least one PRD story.`)
    }
    for (const ref of storyList) {
      const id = (ref as { id?: string })?.id
      const title = (ref as { title?: string })?.title
      if (!id || typeof id !== "string") {
        issues.push(`Wave ${wave.number} contains a story without an \`id\` (shape must be {id, title}).`)
        continue
      }
      if (!prdIds.has(id)) {
        issues.push(`Wave ${wave.number} references story id "${id}"${title ? ` ("${title}")` : ""} that is not in the PRD. Only PRD story ids are allowed.`)
      }
      if (seen.has(id)) {
        issues.push(`Story id "${id}" appears in more than one wave; each PRD story must appear exactly once.`)
      }
      seen.add(id)
    }
    for (const dep of wave.dependencies ?? []) {
      if (typeof dep !== "string" || !/^W\d+$/.test(dep)) {
        issues.push(`Wave ${wave.id} has invalid dependency "${dep}". Dependencies must be an Array<string> of earlier wave ids like "W1" — never prose, never story ids.`)
        continue
      }
      if (!waveIds.has(dep)) {
        issues.push(`Wave ${wave.id} depends on unknown wave "${dep}".`)
      } else if (!waveIdsBefore.get(wave.id)!.has(dep)) {
        issues.push(`Wave ${wave.id} depends on "${dep}" which is not an earlier wave (dependencies must flow forward only).`)
      }
    }
  }
  for (const s of prd.stories) {
    if (!seen.has(s.id)) issues.push(`PRD story "${s.id}" is not assigned to any wave.`)
  }
  return issues.length > 0 ? issues.join(" ") : null
}

function validatingReviewer<S>(
  inner: ReviewAgentAdapter<S, ImplementationPlanArtifact>,
  validate: (artifact: ImplementationPlanArtifact) => string | null,
): ReviewAgentAdapter<S, ImplementationPlanArtifact> {
  return {
    async review(input): Promise<ReviewAgentResponse> {
      if (!input) return inner.review(input)
      const feedback = validate(input.artifact)
      if (feedback) return { kind: "revise", feedback }
      return inner.review(input)
    },
    getSessionId: inner.getSessionId?.bind(inner),
    setSessionId: inner.setSessionId?.bind(inner),
  }
}

export async function planning(ctx: WithArchitecture, llm?: RunLlmConfig): Promise<ImplementationPlanArtifact> {
  stagePresent.header(`planning — ${ctx.project.name}`)

  const { result } = await runStage({
    stageId: "planning",
    stageAgentLabel: "LLM-5 (Planning)",
    reviewerLabel: "Planning-Review-LLM",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): PlanningState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      architectureArtifact: ctx.architecture,
      revisionCount: 0,
    }),
    stageAgent: createPlanningStage(ctx.project, llm),
    reviewer: validatingReviewer(createPlanningReview(llm), artifact => validatePlanStoryIds(artifact, ctx.prd)),
    askUser: async () => "",
    async persistArtifacts(run, artifact) {
      return [
        {
          kind: "json",
          label: "Implementation Plan JSON",
          fileName: "implementation-plan.json",
          content: JSON.stringify(artifact, null, 2),
        },
        {
          kind: "md",
          label: "Implementation Plan Markdown",
          fileName: "implementation-plan.md",
          content: renderPlanMarkdown(artifact),
        },
        summaryArtifactFile(
          "planning",
          stageSummary(run, [`Waves: ${Array.isArray(artifact.plan?.waves) ? artifact.plan.waves.length : 0}`]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      stagePresent.ok("Planning review: implementation plan is ready.")
      const waves = Array.isArray(artifact.plan?.waves) ? artifact.plan.waves : []
      waves.forEach(wave => {
        const tag = wave.parallel ? "(parallel)" : "(sequential)"
        const stories = Array.isArray(wave.stories) ? wave.stories : []
        stagePresent.chat(`Wave ${wave.number} ${tag}`, stories.map(story => story.title).join(", "))
      })
      printStageCompletion(run, "planning")
      return artifact
    },
    maxReviews: 4,
  })

  return result
}
