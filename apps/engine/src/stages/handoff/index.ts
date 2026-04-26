/**
 * Handoff stage — closes out a project run.
 *
 * The project branch is already merged into the item branch by the
 * orchestrator's `git.mergeProjectIntoItem(...)` call before the
 * registry loop reaches handoff; this stage just prints a confirmation
 * banner with the resulting branch names.
 */

import { branchNameItem, branchNameProject } from "../../core/branchNames.js"
import { stagePresent } from "../../core/stagePresentation.js"
import type { GitAdapter } from "../../core/gitAdapter.js"
import type { WithDocumentation } from "../../types.js"

export async function handoff(ctx: WithDocumentation, git: GitAdapter): Promise<void> {
  stagePresent.header(`handoff — ${ctx.project.name}`)
  stagePresent.dim(`→ Item branch: ${branchNameItem(ctx)}`)
  stagePresent.dim(`→ Project branch: ${branchNameProject(ctx, ctx.project.id)}`)
  stagePresent.dim(`→ Base branch: ${git.mode.baseBranch}`)
  stagePresent.ok(
    `Project ${ctx.project.id} is already merged into ${branchNameItem(ctx)}; handoff complete.`,
  )
}
