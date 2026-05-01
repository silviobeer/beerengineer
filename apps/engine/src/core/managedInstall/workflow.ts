import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { AppConfig } from "../../setup/types.js"
import {
  acquireManagedInstallUpdateLock,
  releaseUpdateLock,
} from "../updateMode/lock.js"
import {
  buildManagedInstallSummary,
  createManagedInstallPhase,
  createManagedInstallResult,
} from "./diagnostics.js"
import type {
  ManagedInstallDownloadedRelease,
  ManagedInstallDownloadMetadata,
  ManagedInstallReleaseTarget,
  ManagedInstallResult,
} from "./types.js"
import {
  evaluateManagedInstallState,
  resolveManagedInstallStatePaths,
} from "./state.js"
import { detectManagedWrapperShadow } from "./pathCheck.js"

type ValidateReleaseInput = {
  target: ManagedInstallReleaseTarget
  download: ManagedInstallDownloadedRelease
  stagingDir: string
}

export type ManagedInstallReleaseWorkflowOptions = {
  operationId?: string
  resolveRelease: () => Promise<ManagedInstallReleaseTarget>
  downloadRelease: (target: ManagedInstallReleaseTarget) => Promise<ManagedInstallDownloadedRelease>
  validateRelease: (input: ValidateReleaseInput) => Promise<void> | void
}

export type ManagedInstallCommandPhase = "setup" | "engineStart" | "uiStart"

export type ManagedInstallCommandInvocation = {
  phase: ManagedInstallCommandPhase
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export type ManagedInstallCommandResult = {
  exitCode: number
  stdout?: string
  stderr?: string
}

export type ManagedInstallCompletionWorkflowOptions = {
  operationId?: string
  mode?: "after-activation" | "rerun"
  pathEnv?: string
  resolvedBeerengineerCommandPath?: string | null
  engineUrl?: string
  uiUrl?: string
  uiStartEligible?: boolean
  commandRunner: (invocation: ManagedInstallCommandInvocation) => Promise<ManagedInstallCommandResult>
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

    try {
      mkdirSync(paths.versionsDir, { recursive: true })
      stagingDir = mkdtempSync(join(paths.versionsDir, `.staging-${operationId}-`))
    } catch (err) {
      return failResult(operationId, "staging", "install", err as Error, target)
    }

    let download: ManagedInstallDownloadedRelease
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

export async function runManagedInstallCompletionWorkflow(
  config: Pick<AppConfig, "dataDir">,
  opts: ManagedInstallCompletionWorkflowOptions,
): Promise<ManagedInstallResult> {
  const operationId = opts.operationId ?? randomUUID()
  const paths = resolveManagedInstallStatePaths(config)
  const state = evaluateManagedInstallState(config)
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? ""
  const engineUrl = opts.engineUrl ?? "http://127.0.0.1:4100"
  const uiUrl = opts.uiUrl ?? "http://127.0.0.1:3100"
  const nextCommands: string[] = []
  const phases = [
    createManagedInstallPhase({
      name: "install",
      status: state.status === "already-installed" ? "ok" : "warning",
      message: state.status === "already-installed"
        ? "managed install state is active"
        : `managed install state is ${state.status}`,
      durationMs: 0,
    }),
  ]

  const pathCheck = detectManagedWrapperShadow({
    wrapperPath: paths.wrapperPath,
    pathEnv,
    resolvedCommandPath: opts.resolvedBeerengineerCommandPath,
  })
  if (pathCheck.warning) {
    phases.push(createManagedInstallPhase({
      name: "setup",
      status: "warning",
      message: pathCheck.warning,
      fixHint: pathCheck.fixHint,
      durationMs: 0,
    }))
  }

  if (opts.mode === "rerun" && state.status === "already-installed") {
    nextCommands.push(`${paths.wrapperPath} start`, `${paths.wrapperPath} update`)
    return createManagedInstallResult({
      operationId,
      phases,
      summary: buildManagedInstallSummary({
        phases,
        wrapperPath: paths.wrapperPath,
        nextCommands,
        pathInstructions: pathCheck.pathInstruction ? [pathCheck.pathInstruction] : [],
      }),
    })
  }

  const baseEnv = { ...process.env, PATH: pathEnv }
  const setupFailure = await runSetupPhase(opts, paths.wrapperPath, baseEnv, phases)
  if (setupFailure) return failResult(operationId, "setup", "setup", setupFailure)

  const summaryEngineUrl = await runEngineStartPhase(opts, paths.wrapperPath, baseEnv, phases, nextCommands, engineUrl)

  const uiCommand = `${paths.wrapperPath} start ui`
  const summaryUiUrl = await runUiStartPhase(opts, paths.wrapperPath, baseEnv, phases, nextCommands, uiUrl, uiCommand)

  return createManagedInstallResult({
    operationId,
    phases,
    summary: buildManagedInstallSummary({
      phases,
      wrapperPath: paths.wrapperPath,
      engineUrl: summaryEngineUrl,
      uiUrl: summaryUiUrl,
      nextCommands: dedupe(nextCommands),
      pathInstructions: pathCheck.pathInstruction ? [pathCheck.pathInstruction] : [],
    }),
  })
}

function failResult(
  operationId: string,
  category: "release-resolution" | "download" | "release-validation" | "staging" | "setup" | "lock",
  phaseName: "download" | "install" | "setup",
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

function fixHintForCategory(category: "release-resolution" | "download" | "release-validation" | "staging" | "setup" | "lock"): string {
  if (category === "lock") return "Wait for the active install or update to finish, then retry."
  if (category === "staging") return "Check permissions and free space for the managed install versions directory, then retry."
  if (category === "setup") return "Fix the setup error, then rerun the installer."
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

function commandMessage(result: ManagedInstallCommandResult, fallback: string): string {
  return result.stderr?.trim() || result.stdout?.trim() || fallback
}

async function runSetupPhase(
  opts: ManagedInstallCompletionWorkflowOptions,
  wrapperPath: string,
  env: NodeJS.ProcessEnv,
  phases: ReturnType<typeof createManagedInstallPhase>[],
): Promise<Error | null> {
  const setup = await runManagedCommand(opts, "setup", wrapperPath, ["setup"], env)
  if (setup.exitCode !== 0) return new Error(commandMessage(setup, "setup failed"))
  phases.push(okPhase("setup", "setup completed through managed wrapper"))
  return null
}

async function runEngineStartPhase(
  opts: ManagedInstallCompletionWorkflowOptions,
  wrapperPath: string,
  env: NodeJS.ProcessEnv,
  phases: ReturnType<typeof createManagedInstallPhase>[],
  nextCommands: string[],
  engineUrl: string,
): Promise<string | undefined> {
  const engine = await runManagedCommand(opts, "engineStart", wrapperPath, ["start"], env)
  if (engine.exitCode === 0) {
    phases.push(okPhase("engineStart", `engine available at ${engineUrl}`))
    return engineUrl
  }
  nextCommands.push(`${wrapperPath} start`)
  phases.push(warningPhase(
    "engineStart",
    `engine start failed: ${commandMessage(engine, "manual start required")}`,
    `Run ${wrapperPath} start when ready.`,
  ))
  return undefined
}

async function runUiStartPhase(
  opts: ManagedInstallCompletionWorkflowOptions,
  wrapperPath: string,
  env: NodeJS.ProcessEnv,
  phases: ReturnType<typeof createManagedInstallPhase>[],
  nextCommands: string[],
  uiUrl: string,
  uiCommand: string,
): Promise<string | undefined> {
  if (opts.uiStartEligible === false) {
    nextCommands.push(uiCommand)
    phases.push(warningPhase("uiStart", `UI automatic start is not reliable; run ${uiCommand} and open ${uiUrl}`, uiCommand))
    return uiUrl
  }
  const ui = await runManagedCommand(opts, "uiStart", wrapperPath, ["start", "ui"], env)
  if (ui.exitCode === 0) {
    phases.push(okPhase("uiStart", `UI available at ${uiUrl}`))
    return uiUrl
  }
  nextCommands.push(uiCommand)
  phases.push(warningPhase("uiStart", `UI start failed: ${commandMessage(ui, "manual UI start required")}`, uiCommand))
  return undefined
}

function runManagedCommand(
  opts: ManagedInstallCompletionWorkflowOptions,
  phase: ManagedInstallCommandPhase,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<ManagedInstallCommandResult> {
  return opts.commandRunner({ phase, command, args, env })
}

function okPhase(name: ManagedInstallCommandPhase, message: string) {
  return createManagedInstallPhase({ name, status: "ok", message, durationMs: 0 })
}

function warningPhase(name: ManagedInstallCommandPhase, message: string, fixHint: string) {
  return createManagedInstallPhase({ name, status: "warning", message, fixHint, durationMs: 0 })
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}
