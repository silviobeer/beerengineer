import { readFileSync } from "node:fs"

import type { ImportContextStatus } from "../core/importContext.js"
import type { ArtifactFileRow } from "../db/repositories/types.js"

const IMPORT_CONTEXT_STATUSES = new Set<ImportContextStatus>(["full", "partial", "empty", "unavailable"])

export type ImportContextReadModel = {
  status: ImportContextStatus
  warningCount: number
  visibleFileCount: number
  omittedFileCount: number
}

export type RunArtifactReadModel = ArtifactFileRow & {
  metadata?: {
    importContext?: ImportContextReadModel
  }
}

function isImportContextStatus(value: unknown): value is ImportContextStatus {
  return typeof value === "string" && IMPORT_CONTEXT_STATUSES.has(value as ImportContextStatus)
}

function readImportContextMetadata(artifact: ArtifactFileRow): ImportContextReadModel | undefined {
  if (artifact.label !== "Import Context" || artifact.kind !== "json") return undefined

  try {
    const parsed = JSON.parse(readFileSync(artifact.path, "utf8")) as {
      status?: unknown
      warnings?: unknown
      files?: unknown
    }
    if (!isImportContextStatus(parsed.status)) return undefined

    const files = Array.isArray(parsed.files) ? parsed.files : []
    const warningCount = Array.isArray(parsed.warnings) ? parsed.warnings.length : 0
    const visibleFileCount = files.filter(file => {
      return typeof file === "object" && file !== null && (file as { outcome?: unknown }).outcome === "visible"
    }).length
    return {
      status: parsed.status,
      warningCount,
      visibleFileCount,
      omittedFileCount: Math.max(0, files.length - visibleFileCount),
    }
  } catch {
    return undefined
  }
}

export function buildRunArtifactReadModel(artifact: ArtifactFileRow): RunArtifactReadModel {
  const importContext = readImportContextMetadata(artifact)
  return importContext
    ? { ...artifact, metadata: { importContext } }
    : artifact
}

export function buildRunArtifactReadModels(artifacts: ArtifactFileRow[]): RunArtifactReadModel[] {
  return artifacts.map(buildRunArtifactReadModel)
}
