import { dirname, normalize } from "node:path"

export type ManagedWrapperShadowResult = {
  wrapperDirOnPath: boolean
  shadowed: boolean
  warning: string | null
  fixHint: string
  pathInstruction: string | null
  shouldRemoveGlobalInstall: false
}

export function pathContainsDirectory(pathEnv: string, directory: string, delimiter = process.platform === "win32" ? ";" : ":"): boolean {
  const wanted = normalizeForCompare(directory)
  return pathEnv
    .split(delimiter)
    .map(part => part.trim())
    .filter(Boolean)
    .some(part => normalizeForCompare(part) === wanted)
}

export function detectManagedWrapperShadow(input: {
  wrapperPath: string
  pathEnv: string
  resolvedCommandPath?: string | null
  delimiter?: string
}): ManagedWrapperShadowResult {
  const wrapperDir = dirname(input.wrapperPath)
  const delimiter = input.delimiter ?? (process.platform === "win32" ? ";" : ":")
  const wrapperDirOnPath = pathContainsDirectory(input.pathEnv, wrapperDir, delimiter)
  const resolved = input.resolvedCommandPath?.trim() || null
  const shadowed = Boolean(resolved && normalizeForCompare(resolved) !== normalizeForCompare(input.wrapperPath))
  return {
    wrapperDirOnPath,
    shadowed,
    warning: shadowed
      ? `PATH resolves beerengineer to ${resolved}; managed wrapper is ${input.wrapperPath}.`
      : null,
    fixHint: shadowed
      ? `Put ${wrapperDir} earlier in PATH order or manually remove the old global package.`
      : wrapperDirOnPath
        ? `Managed wrapper directory ${wrapperDir} is already on PATH.`
        : `Add ${wrapperDir} to PATH before running beerengineer from a new shell.`,
    pathInstruction: wrapperDirOnPath ? null : `Add ${wrapperDir} to PATH.`,
    shouldRemoveGlobalInstall: false,
  }
}

function normalizeForCompare(path: string): string {
  const normalized = normalize(path.trim())
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}
