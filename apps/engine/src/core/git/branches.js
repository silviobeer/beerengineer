import { branchNameItem, branchNameProject, branchNameStory, branchNameWave, } from "../branchNames.js";
import { branchExists, currentBranch, itemRoot, runGit } from "./shared.js";
import { assertActiveBranch } from "./inspect.js";
function ensureBranchFrom(mode, branch, from) {
    const root = itemRoot(mode);
    if (branchExists(root, branch)) {
        if (currentBranch(root) === branch)
            return;
        const co = runGit(root, ["checkout", branch]);
        if (!co.ok)
            throw new Error(`git: checkout ${branch} failed: ${co.stderr}`);
        assertActiveBranch(mode, branch, `checking out existing branch ${branch}`);
        return;
    }
    if (!branchExists(root, from)) {
        throw new Error(`git: cannot branch ${branch} from missing base ${from}`);
    }
    const create = runGit(root, ["checkout", "-b", branch, from]);
    if (!create.ok)
        throw new Error(`git: create ${branch} from ${from} failed: ${create.stderr}`);
    assertActiveBranch(mode, branch, `creating branch ${branch} from ${from}`);
}
export function ensureProjectBranch(mode, context, projectId) {
    const name = branchNameProject(context, projectId);
    ensureBranchFrom(mode, name, branchNameItem(context));
    return name;
}
export function ensureWaveBranch(mode, context, projectId, waveNumber) {
    const name = branchNameWave(context, projectId, waveNumber);
    ensureBranchFrom(mode, name, branchNameProject(context, projectId));
    return name;
}
export function ensureStoryBranch(mode, context, projectId, waveNumber, storyId) {
    const name = branchNameStory(context, projectId, waveNumber, storyId);
    ensureBranchFrom(mode, name, branchNameWave(context, projectId, waveNumber));
    return name;
}
export function exitRunToItemBranch(mode, context) {
    const item = branchNameItem(context);
    const root = itemRoot(mode);
    if (!branchExists(root, item)) {
        throw new Error(`branch_gate: cannot exit run because item branch ${item} does not exist`);
    }
    const co = runGit(root, ["checkout", item]);
    if (!co.ok)
        throw new Error(`git: checkout ${item} on run exit failed: ${co.stderr}`);
    assertActiveBranch(mode, item, `exiting run to item branch ${item}`);
    return item;
}
export function abandonStoryBranch(mode, context, projectId, waveNumber, storyId) {
    const root = itemRoot(mode);
    const branch = branchNameStory(context, projectId, waveNumber, storyId);
    if (!branchExists(root, branch))
        return null;
    // Move to a namespaced ref so the branch disappears from `git branch` but
    // remains recoverable. Timestamp prevents collisions on repeat abandons.
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const abandonedRef = `refs/beerengineer/abandoned/${branch}/${stamp}`;
    const sha = runGit(root, ["rev-parse", `refs/heads/${branch}`]);
    if (!sha.ok || !sha.stdout)
        return null;
    // If we're on the branch, park on the item branch (natural resting state),
    // falling back to base only if the item branch hasn't been created yet.
    if (currentBranch(root) === branch) {
        const parkBranch = branchNameItem(context);
        if (branchExists(root, parkBranch)) {
            runGit(root, ["checkout", parkBranch]);
        }
        else if (branchExists(root, mode.baseBranch)) {
            runGit(root, ["checkout", mode.baseBranch]);
        }
    }
    const update = runGit(root, ["update-ref", abandonedRef, sha.stdout]);
    if (!update.ok)
        return null;
    const del = runGit(root, ["branch", "-D", branch]);
    if (!del.ok) {
        runGit(root, ["update-ref", "-d", abandonedRef]);
        return null;
    }
    return { abandonedRef };
}
