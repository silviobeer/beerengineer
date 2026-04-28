const DEFAULT_PREVIEW_HOST = "127.0.0.1"

export function previewHost(): string {
  const raw = process.env.BEERENGINEER_PREVIEW_HOST?.trim()
  return raw || DEFAULT_PREVIEW_HOST
}

export function previewUrlForPort(port: number): string {
  return `http://${previewHost()}:${port}`
}
