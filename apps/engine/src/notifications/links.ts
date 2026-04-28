import { normalizePublicBaseUrl } from "../setup/config.js"

export type ExternalLinkBuilder = {
  publicBaseUrl: string
  run(runId: string): string
  item(itemId: string): string
  workspace(workspaceId: string): string
}

function joinPath(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${baseUrl}${normalizedPath}`
}

export function createExternalLinkBuilder(publicBaseUrl: string): ExternalLinkBuilder {
  const normalizedBaseUrl = normalizePublicBaseUrl(publicBaseUrl)
  return {
    publicBaseUrl: normalizedBaseUrl,
    run: runId => joinPath(normalizedBaseUrl, `/runs/${encodeURIComponent(runId)}`),
    item: itemId => joinPath(normalizedBaseUrl, `/items/${encodeURIComponent(itemId)}`),
    workspace: workspaceId => joinPath(normalizedBaseUrl, `/workspaces/${encodeURIComponent(workspaceId)}`),
  }
}
