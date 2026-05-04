function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x"
}

export function waveBranchName(input: {
  workspace: string
  runId: string
  itemId: string
  projectId: string
  waveId: string
}): string {
  return [
    "beerengineer",
    slug(input.workspace),
    slug(input.runId),
    slug(input.itemId),
    slug(input.projectId),
    slug(input.waveId),
  ].join("-")
}

export function ownedWaveBranchPrefix(workspace: string): string {
  return `beerengineer-${slug(workspace)}-`
}

export function parseOwnedWaveBranchName(name: string, workspace: string): { owned: boolean; workspaceSlug: string } {
  const prefix = ownedWaveBranchPrefix(workspace)
  return { owned: name.startsWith(prefix), workspaceSlug: slug(workspace) }
}
