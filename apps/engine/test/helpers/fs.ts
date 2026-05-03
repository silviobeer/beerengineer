import { rmSync } from "node:fs"

export const CLEANUP_RM_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const

export function removeTempDir(path: string): void {
  rmSync(path, CLEANUP_RM_OPTIONS)
}
