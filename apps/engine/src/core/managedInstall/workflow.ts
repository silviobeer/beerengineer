import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { AppConfig } from "../../setup/types.js"
import {
  acquireManagedInstallUpdateLock,
  releaseUpdateLock,
} from "../updateMode/lock.js"
import {
  createManagedInstallPhase,
  createManagedInstallResult,
} from "./diagnostics.js"
import type {
  ManagedInstallDownloadMetadata,
  ManagedInstallReleaseTarget,
  ManagedInstallResult,
} from "./types.js"
import { resolveManagedInstallStatePaths } from "./state.js"

type DownloadedRelease = {
  body: Buffer
  finalUrl: string
}

type ValidateReleaseInput = {
  target: ManagedInstallReleaseTarget
  download: DownloadedRelease
  stagingDir: string
}

export type ManagedInstallReleaseWorkflowOptions = {
  operationId?: string
  resolveRelease: () => Promise<ManagedInstallReleaseTarget>
  downloadRelease: (target: ManagedInstallReleaseTarget) => Promise<DownloadedRelease>
  validateRelease: (input: ValidateReleaseInput) => Promise<void> | void
}

export async function runManagedInstallReleaseWorkflow(
  config: Pick<AppConfig, "dataDir">,
  opts: ManagedInstallReleaseWorkflowOptions,
): Promise<ManagedInstallResult> {
  const operationId = opts.operationId ?? randomUUID()
  const paths = resolveManagedInstallStatePaths(config)
  let target: ManagedInstallReleaseTarget | undefined
  let stagingDir: string | null = null
  let lockOperationId: string | null = null

  try {
    const lock = acquireManagedInstallUpdateLock(config, { operationId })
    lockOperationId = lock.record.operationId

    try {
      target = await opts.resolveRelease()
    } catch (err) {
      return failResult(operationId, "release-resolution", "download", err as Error, target)
    }

    mkdirSync(paths.versionsDir, { recursive: true })
    stagingDir = mkdtempSync(join(paths.versionsDir, `.staging-${operationId}-`))

    let download: DownloadedRelease
    try {
      download = await opts.downloadRelease(target)
    } catch (err) {
      return failResult(operationId, "download", "download", err as Error, target)
    }

    try {
      await opts.validateRelease({ target, download, stagingDir })
    } catch (err) {
      return failResult(operationId, "release-validation", "install", err as Error, target)
    }

    return createManagedInstallResult({
      operationId,
      target: withDownloadMetadata(target),
      phases: [
        createManagedInstallPhase({
          name: "download",
          status: "ok",
          message: `downloaded release tarball from ${download.finalUrl}`,
          durationMs: 0,
        }),
        createManagedInstallPhase({
          name: "install",
          status: "ok",
          message: `validated release ${target.tag} without activating current state`,
          durationMs: 0,
        }),
      ],
    })
  } catch (err) {
    return failResult(operationId, "lock", "install", err as Error, target)
  } finally {
    if (stagingDir) rmSync(stagingDir, { recursive: true, force: true })
    if (lockOperationId) releaseUpdateLock(config, lockOperationId)
  }
}

function failResult(
  operationId: string,
  category: "release-resolution" | "download" | "release-validation" | "lock",
  phaseName: "download" | "install",
  err: Error,
  target?: ManagedInstallReleaseTarget,
): ManagedInstallResult {
  const message = `${category} failed: ${err.message}`
  const result = createManagedInstallResult({
    operationId,
    target,
    phases: [
      createManagedInstallPhase({
        name: phaseName,
        status: "failed",
        message,
        fixHint: fixHintForCategory(category),
        durationMs: 0,
      }),
    ],
  })
  return {
    ...result,
    error: { message },
  }
}

function fixHintForCategory(category: "release-resolution" | "download" | "release-validation" | "lock"): string {
  if (category === "lock") return "Wait for the active install or update to finish, then retry."
  if (category === "release-resolution") return "Check GitHub release availability and rerun the installer."
  if (category === "download") return "Check network access to the trusted GitHub download host, then retry."
  return "Inspect the release contents and retry with a valid beerengineer release."
}

function withDownloadMetadata(target: ManagedInstallReleaseTarget): ManagedInstallReleaseTarget {
  const download: ManagedInstallDownloadMetadata = {
    tarballUrl: target.download.tarballUrl,
    host: target.download.host,
    protocol: target.download.protocol,
  }
  return { ...target, download }
}
