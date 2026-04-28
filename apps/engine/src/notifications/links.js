import { normalizePublicBaseUrl } from "../setup/config.js";
function joinPath(baseUrl, path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
}
export function createExternalLinkBuilder(publicBaseUrl) {
    const normalizedBaseUrl = normalizePublicBaseUrl(publicBaseUrl);
    return {
        publicBaseUrl: normalizedBaseUrl,
        run: runId => joinPath(normalizedBaseUrl, `/runs/${encodeURIComponent(runId)}`),
        item: itemId => joinPath(normalizedBaseUrl, `/items/${encodeURIComponent(itemId)}`),
        workspace: workspaceId => joinPath(normalizedBaseUrl, `/workspaces/${encodeURIComponent(workspaceId)}`),
    };
}
