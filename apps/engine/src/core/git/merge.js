import { branchNameItem, branchNameProject, branchNameStory, branchNameWave, } from "../branchNames.js";
import { resolveMergeConflictsViaLlm } from "../mergeResolver.js";
import { branchExists, itemRoot, runGit } from "./shared.js";
import { assertActiveBranch } from "./inspect.js";
import { listWorktrees } from "./worktrees.js";
function tipSha(root, ref) {
    return runGit(root, ["rev-parse", ref]).stdout;
}
function tryResolveAndCommit(root, message, opts, stderr) {
    if (!opts.mergeResolver)
        return false;
    if (!/CONFLICT|Automatic merge failed/i.test(stderr))
        return false;
    const resolution = resolveMergeConflictsViaLlm({
        workspaceRoot: root,
        mergeMessage: message,
        harness: opts.mergeResolver,
        logDir: opts.resolverLogDir,
        expectedSharedFiles: opts.expectedSharedFiles,
    });
    if (!resolution.ok)
        return false;
    // Resolver already staged with `git add -A`; just complete the merge.
    return runGit(root, ["commit", "--no-edit"]).ok;
}
/**
 * Generic --no-ff merge of `source` into `target`. Single workhorse for all
 * four levels (story→wave, wave→project, project→item, item→base).
 *
 * Returns the merge commit SHA. Throws on unresolved conflict.
 */
function mergeBranchInto(mode, target, source, message, opts = {}) {
    const root = opts.root ?? itemRoot(mode);
    const co = runGit(root, ["checkout", target]);
    if (!co.ok)
        throw new Error(`git: checkout ${target} for merge failed: ${co.stderr || co.stdout}`);
    if (root === itemRoot(mode))
        assertActiveBranch(mode, target, `checking out merge target ${target}`);
    const head = tipSha(root, "HEAD");
    const sourceHead = tipSha(root, source);
    if (head && head === sourceHead)
        return { mergeSha: head };
    const ancestor = runGit(root, ["merge-base", "--is-ancestor", source, target]);
    if (ancestor.ok)
        return { mergeSha: tipSha(root, target) };
    const merge = runGit(root, ["merge", "--no-ff", "-m", message, source]);
    if (merge.ok)
        return { mergeSha: tipSha(root, "HEAD") };
    const stderr = merge.stderr || merge.stdout;
    if (tryResolveAndCommit(root, message, opts, stderr))
        return { mergeSha: tipSha(root, "HEAD") };
    runGit(root, ["merge", "--abort"]);
    throw new Error(`git: merge ${source} → ${target} failed: ${stderr}`);
}
export function mergeStoryIntoWave(mode, context, projectId, waveNumber, storyId, opts = {}) {
    mergeBranchInto(mode, branchNameWave(context, projectId, waveNumber), branchNameStory(context, projectId, waveNumber, storyId), `Merge story ${storyId} into wave ${waveNumber}`, opts);
}
export function mergeWaveIntoProject(mode, context, projectId, waveNumber, opts = {}) {
    mergeBranchInto(mode, branchNameProject(context, projectId), branchNameWave(context, projectId, waveNumber), `Merge wave ${waveNumber} into project ${projectId}`, opts);
}
export function mergeProjectIntoItem(mode, context, projectId, opts = {}) {
    mergeBranchInto(mode, branchNameItem(context), branchNameProject(context, projectId), `Merge project ${projectId} into item`, opts);
}
export function mergeItemIntoBase(mode, context) {
    const item = branchNameItem(context);
    if (!branchExists(mode.workspaceRoot, item)) {
        throw new Error(`git: item branch ${item} does not exist`);
    }
    return mergeBranchInto(mode, mode.baseBranch, item, `Merge item ${context.itemSlug ?? "item"} into ${mode.baseBranch}`, { root: mode.workspaceRoot });
}
/**
 * Rebase the story branch onto the current wave HEAD inside the story's
 * worktree. On conflict, abort and return `ok: false` — never auto-resolve,
 * because the parallel path is riskier and the merge resolver is the right
 * tool for *integration*, not for in-flight rebases that may still be
 * mid-implementation.
 */
export function rebaseStoryOntoWave(mode, context, projectId, waveNumber, storyId) {
    const storyBranch = branchNameStory(context, projectId, waveNumber, storyId);
    const waveBranch = branchNameWave(context, projectId, waveNumber);
    const primary = mode.workspaceRoot;
    if (!branchExists(primary, storyBranch))
        return { ok: false, reason: "story_branch_missing" };
    if (!branchExists(primary, waveBranch))
        return { ok: false, reason: "wave_branch_missing" };
    // Rebase has to run inside the worktree currently holding the story branch
    // — git refuses to touch a branch checked out elsewhere.
    const worktree = listWorktrees(primary).find(entry => entry.branch === storyBranch);
    if (!worktree)
        return { ok: false, reason: "worktree_missing" };
    // Fast-path: skip when story already has wave-tip as ancestor; keeps logs
    // quiet on the common "wave didn't move" case.
    if (runGit(worktree.path, ["merge-base", "--is-ancestor", waveBranch, storyBranch]).ok) {
        return { ok: true };
    }
    const rebase = runGit(worktree.path, ["rebase", waveBranch]);
    if (rebase.ok)
        return { ok: true };
    // Capture conflicting paths before aborting; `--diff-filter=U` returns
    // nothing once the index resets.
    const conflictPaths = runGit(worktree.path, ["diff", "--name-only", "--diff-filter=U"]);
    const paths = conflictPaths.ok && conflictPaths.stdout
        ? conflictPaths.stdout.split(/\r?\n/).filter(Boolean).join(",")
        : "<unknown>";
    runGit(worktree.path, ["rebase", "--abort"]);
    return { ok: false, reason: `rebase_conflict_on:${paths}` };
}
