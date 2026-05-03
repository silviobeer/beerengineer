const DEFAULT_PREVIEW_HOST = "127.0.0.1"

function hostFromPublicBaseUrl(): string | null {
  const raw = process.env.BEERENGINEER_PUBLIC_BASE_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.hostname || null
  } catch {
    return null
  }
}

export function previewHost(): string {
  const explicit = process.env.BEERENGINEER_PREVIEW_HOST?.trim()
  if (explicit) return explicit
  return hostFromPublicBaseUrl() ?? DEFAULT_PREVIEW_HOST
}

export function previewUrlForPort(port: number): string {
  return `http://${previewHost()}:${port}`
}
