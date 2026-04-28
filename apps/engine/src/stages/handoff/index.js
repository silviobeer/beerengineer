/**
 * Handoff stage — closes out a project run by merging the project branch
 * into the item branch and printing the result.
 *
 * The merge happens *inside* this stage so that:
 *   - merge failure is captured under `withStageLifecycle("handoff", …)`
 *     and lands in the same recovery scope as any other handoff issue,
 *   - the "Project X is merged into Y" banner is true at the moment it
 *     prints (it was a lie when the merge ran outside this stage).
 *
 * Resume semantics: re-running handoff on an already-merged tree is a
 * no-op for `git.mergeProjectIntoItem` (the underlying merge command
 * short-circuits when the project branch is an ancestor of item), so
 * idempotency is preserved.
 */
import { branchNameItem, branchNameProject } from "../../core/branchNames.js";
import { stagePresent } from "../../core/stagePresentation.js";
export async function handoff(ctx, git) {
    stagePresent.header(`handoff — ${ctx.project.name}`);
    stagePresent.dim(`→ Item branch: ${branchNameItem(ctx)}`);
    stagePresent.dim(`→ Project branch: ${branchNameProject(ctx, ctx.project.id)}`);
    stagePresent.dim(`→ Base branch: ${git.mode.baseBranch}`);
    git.mergeProjectIntoItem(ctx.project.id);
    git.assertWorkspaceRootOnBaseBranch(`after merging project ${ctx.project.id} into item`);
    stagePresent.ok(`Project ${ctx.project.id} merged into ${branchNameItem(ctx)}; handoff complete.`);
}
