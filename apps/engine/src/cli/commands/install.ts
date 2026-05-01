import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolveManagedInstallRelease } from "../../core/managedInstall/release.js"
import { downloadManagedInstallTarball } from "../../core/managedInstall/download.js"
import { runManagedInstallPrerequisiteProbe } from "../../core/managedInstall/prerequisites.js"
import {
  listManagedInstallTarballEntries,
  MANAGED_INSTALL_TAR_TIMEOUT_MS,
  managedInstallTarFailureMessage,
  measureDirectoryBytes,
  validateManagedInstallArchiveEntries,
  validateManagedInstallReleaseSizes,
  validateManagedInstallReleaseTree,
} from "../../core/managedInstall/validation.js"
import {
  activateManagedInstallVersion,
  evaluateManagedInstallState,
  resolveManagedInstallStatePaths,
  safeReleaseTag,
} from "../../core/managedInstall/state.js"
import type {
  ManagedInstallDownloadedRelease,
  ManagedInstallPhase,
  ManagedInstallReleaseTarget,
  ManagedInstallResult,
} from "../../core/managedInstall/types.js"
import {
  buildManagedInstallSummary,
  createManagedInstallErrorResult,
  createManagedInstallResult,
  renderManagedInstallJson,
  renderManagedInstallHuman,
} from "../../core/managedInstall/diagnostics.js"
import {
  runManagedInstallCompletionWorkflow,
  runManagedInstallReleaseWorkflow,
  type ManagedInstallCommandInvocation,
  type ManagedInstallCommandResult,
} from "../../core/managedInstall/workflow.js"
import { defaultAppConfig } from "../../setup/config.js"
import type { AppConfig } from "../../setup/types.js"
import type { Command } from "../types.js"
import { loadEffectiveConfig } from "../common.js"

type InstalledRelease = {
  extractedRoot: string
  extractedBytes: number
}

export type ManagedInstallCommandDeps = {
  operationId?: () => string
  config?: Pick<AppConfig, "dataDir">
  probePrerequisites?: () => Promise<ManagedInstallPhase>
  resolveRelease?: () => Promise<ManagedInstallReleaseTarget>
  downloadRelease?: (target: ManagedInstallReleaseTarget) => Promise<ManagedInstallDownloadedRelease>
  installDownloadedRelease?: (input: {
    config: Pick<AppConfig, "dataDir">
    target: ManagedInstallReleaseTarget
    download: ManagedInstallDownloadedRelease
    stagingDir: string
  }) => Promise<InstalledRelease>
  commandRunner?: (invocation: ManagedInstallCommandInvocation) => Promise<ManagedInstallCommandResult>
  pathEnv?: string
  resolvedBeerengineerCommandPath?: string | null
  uiStartEligible?: boolean
  writeStdout?: (chunk: string) => void
  writeStderr?: (chunk: string) => void
}

export async function runManagedInstallCommand(
  cmd: Extract<Command, { kind: "install" }>,
  deps: ManagedInstallCommandDeps = {},
): Promise<number> {
  const operationId = deps.operationId?.() ?? `bootstrap-${Date.now()}`
  const probePrerequisites = deps.probePrerequisites ?? runManagedInstallPrerequisiteProbe
  const resolveRelease = deps.resolveRelease ?? resolveManagedInstallRelease
  const downloadRelease = deps.downloadRelease ?? (target => downloadManagedInstallTarball(target.tarballUrl))
  const installDownloadedRelease = deps.installDownloadedRelease ?? installDownloadedManagedRelease
  const commandRunner = deps.commandRunner ?? runManagedInstallSubcommand
  const writeStdout = deps.writeStdout ?? ((chunk: string) => {
    process.stdout.write(chunk)
  })
  const writeStderr = deps.writeStderr ?? ((chunk: string) => {
    process.stderr.write(chunk)
  })

  try {
    const config = deps.config ?? loadEffectiveConfig() ?? defaultAppConfig()
    const prerequisitePhase = await probePrerequisites()
    if (prerequisitePhase.status === "failed") {
      const result = failedResult(operationId, [prerequisitePhase], prerequisitePhase.message)
      writeResult(cmd, result, writeStdout, writeStderr)
      return result.exitCode
    }

    const existingState = evaluateManagedInstallState(config)
    if (existingState.status === "hard-stop") {
      const result = failedResult(operationId, [prerequisitePhase], existingState.stop?.message ?? existingState.reason)
      writeResult(cmd, result, writeStdout, writeStderr)
      return result.exitCode
    }
    if (existingState.status === "already-installed") {
      const completion = await runManagedInstallCompletionWorkflow(config, {
        operationId,
        mode: "rerun",
        pathEnv: deps.pathEnv,
        resolvedBeerengineerCommandPath: deps.resolvedBeerengineerCommandPath,
        commandRunner,
      })
      const result = createManagedInstallResult({
        operationId,
        phases: [prerequisitePhase, ...completion.phases],
        summary: completion.summary,
      })
      writeResult(cmd, result, writeStdout, writeStderr)
      return result.exitCode
    }

    const installedRelease: { value?: InstalledRelease } = {}
    const releaseResult = await runManagedInstallReleaseWorkflow(config, {
      operationId,
      resolveRelease,
      downloadRelease,
      validateRelease: async ({ target, download, stagingDir }) => {
        installedRelease.value = await installDownloadedRelease({ config, target, download, stagingDir })
      },
    })
    if (releaseResult.exitCode !== 0) {
      const result = {
        ...createManagedInstallResult({
          operationId,
          target: releaseResult.target,
          phases: [prerequisitePhase, ...releaseResult.phases],
          summary: buildManagedInstallSummary({ phases: [prerequisitePhase, ...releaseResult.phases] }),
        }),
        error: releaseResult.error,
      }
      writeResult(cmd, result, writeStdout, writeStderr)
      return result.exitCode
    }
    const releasePhases = installedRelease.value
      ? annotateInstallPhaseWithExtractedBytes(releaseResult.phases, installedRelease.value.extractedBytes)
      : releaseResult.phases

    const completion = await runManagedInstallCompletionWorkflow(config, {
      operationId,
      pathEnv: deps.pathEnv,
      resolvedBeerengineerCommandPath: deps.resolvedBeerengineerCommandPath,
      uiStartEligible: deps.uiStartEligible,
      commandRunner,
    })
    const phases = [prerequisitePhase, ...releasePhases, ...completion.phases]
    const result = createManagedInstallResult({
      operationId,
      target: releaseResult.target,
      phases,
      summary: completion.summary,
    })
    writeResult(cmd, result, writeStdout, writeStderr)
    return result.exitCode
  } catch (err) {
    const message = (err as Error).message
    const result = createManagedInstallErrorResult({ operationId, error: new Error(message) })
    writeResult(cmd, result, writeStdout, writeStderr)
    return result.exitCode
  }
}

async function installDownloadedManagedRelease(input: {
  config: Pick<AppConfig, "dataDir">
  target: ManagedInstallReleaseTarget
  download: ManagedInstallDownloadedRelease
  stagingDir: string
}): Promise<InstalledRelease> {
  const tarballPath = join(input.stagingDir, `${input.target.version}.tar.gz`)
  const extractDir = join(input.stagingDir, "extract")
  mkdirSync(extractDir, { recursive: true })
  writeFileSync(tarballPath, input.download.body)
  validateManagedInstallArchiveEntries(listManagedInstallTarballEntries(tarballPath))
  const extract = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    encoding: "utf8",
    timeout: MANAGED_INSTALL_TAR_TIMEOUT_MS,
  })
  if (extract.status !== 0) {
    throw new Error(`managed_install_validate_failed:tar_extract_failed:${managedInstallTarFailureMessage(extract.stderr, extract.stdout, extract.error)}`)
  }
  const entries = readdirSync(extractDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
  if (entries.length !== 1) throw new Error("managed_install_validate_failed:unexpected_tarball_layout")
  const extractedRoot = join(extractDir, entries[0].name)
  const extractedBytes = measureDirectoryBytes(extractedRoot)
  validateManagedInstallReleaseSizes({ tarballBytes: input.download.body.byteLength, extractedBytes })
  validateManagedInstallReleaseTree(extractedRoot, input.target)

  const paths = resolveManagedInstallStatePaths(input.config)
  const versionDir = join(paths.versionsDir, safeReleaseTag(input.target.tag))
  rmSync(versionDir, { recursive: true, force: true })
  mkdirSync(paths.versionsDir, { recursive: true })
  renameSync(extractedRoot, versionDir)
  activateManagedInstallVersion(input.config, { tag: input.target.tag, version: input.target.version })
  return { extractedRoot: versionDir, extractedBytes }
}

function annotateInstallPhaseWithExtractedBytes(phases: ManagedInstallPhase[], extractedBytes: number): ManagedInstallPhase[] {
  return phases.map(phase => phase.name === "install" && phase.status === "ok"
    ? { ...phase, message: `${phase.message} (${extractedBytes} bytes extracted)` }
    : phase)
}

async function runManagedInstallSubcommand(invocation: ManagedInstallCommandInvocation): Promise<ManagedInstallCommandResult> {
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: invocation.env,
    timeout: 60_000,
  })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr || result.error?.message,
  }
}

function writeResult(
  cmd: Extract<Command, { kind: "install" }>,
  result: ManagedInstallResult,
  writeStdout: (chunk: string) => void,
  writeStderr: (chunk: string) => void,
): void {
  if (cmd.json) {
    writeStdout(renderManagedInstallJson(result))
    return
  }
  const rendered = renderManagedInstallHuman(result)
  if (result.exitCode === 0) writeStdout(rendered)
  else writeStderr(rendered)
}

function failedResult(operationId: string, phases: ManagedInstallPhase[], message: string): ManagedInstallResult {
  return {
    ...createManagedInstallResult({
      operationId,
      phases,
      summary: buildManagedInstallSummary({ phases }),
    }),
    error: { message },
  }
}
