/**
 * Pure helpers for engine-managed branch names.
 *
 * Branch naming is a deterministic function of `itemSlug`, `runId`,
 * `projectId`, and `waveNumber`/`storyId`. These names are used by both
 * the real-git adapter (when creating actual branches) and any reporting
 * surface that wants to refer to a branch by name without instantiating
 * a git operation.
 */
function slugify(value, fallback = "branch") {
    const slug = value
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-+|-+$/g, "");
    return slug || fallback;
}
function itemSlugFromContext(context) {
    if (!context.itemSlug) {
        throw new Error("WorkflowContext.itemSlug is required for branch operations");
    }
    return slugify(context.itemSlug, "item");
}
function joinBranch(kind, ...segments) {
    return `${kind}/${segments.join("__")}`;
}
export function branchNameItem(context) {
    return joinBranch("item", itemSlugFromContext(context));
}
export function branchNameProject(context, projectId) {
    return joinBranch("proj", itemSlugFromContext(context), slugify(projectId));
}
export function branchNameWave(context, projectId, waveNumber) {
    return joinBranch("wave", itemSlugFromContext(context), slugify(projectId), `w${waveNumber}`);
}
export function branchNameStory(context, projectId, waveNumber, storyId) {
    return joinBranch("story", itemSlugFromContext(context), slugify(projectId), `w${waveNumber}`, slugify(storyId));
}
export function branchNameCandidate(context, projectId) {
    return joinBranch("candidate", slugify(context.runId), itemSlugFromContext(context), slugify(projectId));
}
