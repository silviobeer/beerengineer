import type { Repos } from "../db/repositories.js"

// Derives the on-disk workspace id used by the workflow runtime. Must stay in
// lockstep with WorkflowContext.workspaceId assembly in workflow.ts; changing
// it would orphan every existing item's artifacts on disk.
export function workflowWorkspaceId(item: { id: string; title: string }): string {
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return slug ? `${slug}-${item.id.toLowerCase()}` : item.id.toLowerCase()
}

export function latestCompletedRunForItem(repos: Repos, itemId: string) {
  return repos
    .listRuns()
    .filter(run => run.item_id === itemId && run.status === "completed")
    .sort((a, b) => b.created_at - a.created_at)[0]
}
