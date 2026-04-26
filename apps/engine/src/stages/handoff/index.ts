/**
 * Handoff stage — closes out a project run.
 *
 * In real-git mode the project branch is already merged into the item
 * branch by the orchestrator; handoff just prints a confirmation banner.
 *
 * In simulated-git mode handoff also creates a "candidate" branch on top
 * of the simulated commit log and asks the operator how to dispose of it
 * (test/merge/reject). The mergeProjectBranchIntoItem call updates the
 * simulated branch graph that drives the handoff prompt.
 */

import {
  branchNameItem,
  branchNameProject,
  createCandidateBranch,
  finalizeCandidateDecision,
  mergeProjectBranchIntoItem,
} from "../../core/repoSimulation.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { ask } from "../../sim/human.js"
import type { GitAdapter } from "../../core/gitAdapter.js"
import type { WithDocumentation } from "../../types.js"

function normalizeDecision(input: string): "test" | "merge" | "reject" {
  const normalized = input.trim().toLowerCase()
  if (normalized === "merge") return "merge"
  if (normalized === "reject") return "reject"
  return "test"
}

export async function handoff(ctx: WithDocumentation, git: GitAdapter): Promise<void> {
  await mergeProjectBranchIntoItem(ctx, ctx.project.id)

  if (git.mode.enabled) {
    stagePresent.header(`handoff — ${ctx.project.name}`)
    stagePresent.dim(`→ Item branch: ${branchNameItem(ctx)}`)
    stagePresent.dim(`→ Project branch: ${branchNameProject(ctx, ctx.project.id)}`)
    stagePresent.dim(`→ Base branch: ${git.mode.baseBranch}`)
    stagePresent.ok(
      `Project ${ctx.project.id} is already merged into ${branchNameItem(ctx)}; handoff complete.`,
    )
    return
  }

  const handoffResult = await createCandidateBranch(ctx, ctx.project, ctx.documentation)
  stagePresent.header(`handoff — ${ctx.project.name}`)
  stagePresent.ok(handoffResult.summary)
  stagePresent.dim(`→ Candidate: ${handoffResult.candidateBranch.name}`)
  stagePresent.dim(`→ Parent: ${handoffResult.candidateBranch.base}`)
  stagePresent.dim(`→ Base: ${handoffResult.mergeTargetBranch}`)
  handoffResult.mergeChecklist.forEach(item => stagePresent.dim(`→ ${item}`))

  const decisionRaw = await ask("  Test, merge or reject candidate? [test/merge/reject] > ")
  const decision = normalizeDecision(decisionRaw)
  const updated = await finalizeCandidateDecision(ctx, handoffResult, decision)
  stagePresent.ok(updated.summary)
}
