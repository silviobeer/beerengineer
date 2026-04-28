export function itemSlug(item: { id: string; title: string }): string {
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return slug || item.id.toLowerCase()
}

export function workflowWorkspaceId(item: { id: string; title: string }): string {
  const raw = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return raw ? `${raw}-${item.id.toLowerCase()}` : item.id.toLowerCase()
}
