const DEFAULT_PREVIEW_HOST = "127.0.0.1";
export function previewHost() {
    const raw = process.env.BEERENGINEER_PREVIEW_HOST?.trim();
    return raw || DEFAULT_PREVIEW_HOST;
}
export function previewUrlForPort(port) {
    return `http://${previewHost()}:${port}`;
}
