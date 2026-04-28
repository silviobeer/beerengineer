/**
 * Pure helpers for engine-managed branch names.
 *
 * Branch naming is a deterministic function of `itemSlug`, `runId`,
 * `projectId`, and `waveNumber`/`storyId`. These names are used by both
 * the real-git adapter (when creating actual branches) and any reporting
 * surface that wants to refer to a branch by name without instantiating
 * a git operation.
 */

import type { WorkflowContext } from "./workspaceLayout.js"

function slugify(value: string, fallback = "branch"): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
  return slug || fallback
}

function itemSlugFromContext(context: WorkflowContext): string {
  if (!context.itemSlug) {
    throw new Error("WorkflowContext.itemSlug is required for branch operations")
  }
  return slugify(context.itemSlug, "item")
}

function joinBranch(kind: string, ...segments: string[]): string {
  return `${kind}/${segments.join("__")}`
}

export function branchNameItem(context: WorkflowContext): string {
  return joinBranch("item", itemSlugFromContext(context))
}

export function branchNameProject(context: WorkflowContext, projectId: string): string {
  return joinBranch("proj", itemSlugFromContext(context), slugify(projectId))
}

export function branchNameWave(context: WorkflowContext, projectId: string, waveNumber: number): string {
  return joinBranch("wave", itemSlugFromContext(context), slugify(projectId), `w${waveNumber}`)
}

export function branchNameStory(
  context: WorkflowContext,
  projectId: string,
  waveNumber: number,
  storyId: string,
): string {
  return joinBranch("story", itemSlugFromContext(context), slugify(projectId), `w${waveNumber}`, slugify(storyId))
}

export function branchNameCandidate(context: WorkflowContext, projectId: string): string {
  return joinBranch("candidate", slugify(context.runId), itemSlugFromContext(context), slugify(projectId))
}
