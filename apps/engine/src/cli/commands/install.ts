import { resolveManagedInstallRelease } from "../../core/managedInstall/release.js"
import type { ManagedInstallReleaseTarget } from "../../core/managedInstall/types.js"
import {
  buildManagedInstallSummary,
  createManagedInstallErrorResult,
  createManagedInstallPhase,
  createManagedInstallResult,
  renderManagedInstallJson,
} from "../../core/managedInstall/diagnostics.js"
import type { Command } from "../types.js"

export type ManagedInstallCommandDeps = {
  operationId?: () => string
  resolveRelease?: () => Promise<ManagedInstallReleaseTarget>
  writeStdout?: (chunk: string) => void
  writeStderr?: (chunk: string) => void
}

export async function runManagedInstallCommand(
  cmd: Extract<Command, { kind: "install" }>,
  deps: ManagedInstallCommandDeps = {},
): Promise<number> {
  const operationId = deps.operationId?.() ?? `bootstrap-${Date.now()}`
  const resolveRelease = deps.resolveRelease ?? resolveManagedInstallRelease
  const writeStdout = deps.writeStdout ?? ((chunk: string) => {
    process.stdout.write(chunk)
  })
  const writeStderr = deps.writeStderr ?? ((chunk: string) => {
    process.stderr.write(chunk)
  })

  try {
    const target = await resolveRelease()
    const phases = [
      createManagedInstallPhase({
        name: "download",
        status: "ok",
        message: `resolved stable release ${target.repo} ${target.tag}`,
        durationMs: 0,
      }),
    ]
    const result = createManagedInstallResult({
      operationId,
      target,
      phases,
      summary: buildManagedInstallSummary({
        phases,
        nextCommands: ["managed install workflow will continue from the resolved release"],
      }),
    })
    if (cmd.json) writeStdout(renderManagedInstallJson(result))
    else {
      writeStdout([
        "beerengineer_ managed install starting",
        `repo: ${target.repo}`,
        `target: ${target.tag} (${target.version})`,
        `source: ${target.tarballUrl}`,
        "",
      ].join("\n"))
    }
    return 0
  } catch (err) {
    const message = (err as Error).message
    if (cmd.json) {
      writeStdout(renderManagedInstallJson(createManagedInstallErrorResult({
        operationId,
        error: new Error(message),
      })))
    }
    else {
      writeStderr("beerengineer_ managed install cannot start\n")
      writeStderr(`${message.includes("no_stable_release")
        ? "No stable GitHub release is available yet."
        : message}\n`)
    }
    return 1
  }
}
