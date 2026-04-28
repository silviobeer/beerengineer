export function itemSlug(item: { id: string; title: string }): string {
  const slug = item.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")
  return slug || item.id.toLowerCase()
}

export function workflowWorkspaceId(item: { id: string; title: string }): string {
  const raw = item.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")
  return raw ? `${raw}-${item.id.toLowerCase()}` : item.id.toLowerCase()
}
