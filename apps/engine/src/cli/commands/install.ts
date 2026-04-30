import { resolveManagedInstallRelease } from "../../core/managedInstall/release.js"
import { renderManagedInstallJson } from "../../core/managedInstall/diagnostics.js"
import { createManagedInstallResult, createManagedInstallPhase, buildManagedInstallSummary } from "../../core/managedInstall/diagnostics.js"
import type { Command } from "../types.js"

export async function runManagedInstallCommand(cmd: Extract<Command, { kind: "install" }>): Promise<number> {
  try {
    const target = await resolveManagedInstallRelease()
    const phases = [
      createManagedInstallPhase({
        name: "download",
        status: "ok",
        message: `resolved stable release ${target.repo} ${target.tag}`,
        durationMs: 0,
      }),
    ]
    const result = createManagedInstallResult({
      operationId: `bootstrap-${Date.now()}`,
      target,
      phases,
      summary: buildManagedInstallSummary({
        phases,
        nextCommands: ["managed install workflow will continue from the resolved release"],
      }),
    })
    if (cmd.json) process.stdout.write(renderManagedInstallJson(result))
    else {
      console.log(`beerengineer_ managed install starting`)
      console.log(`repo: ${target.repo}`)
      console.log(`target: ${target.tag} (${target.version})`)
      console.log(`source: ${target.tarballUrl}`)
    }
    return 0
  } catch (err) {
    const message = (err as Error).message
    if (cmd.json) process.stdout.write(`${JSON.stringify({ status: "failed", error: message })}\n`)
    else {
      console.error("beerengineer_ managed install cannot start")
      console.error(message.includes("no_stable_release")
        ? "No stable GitHub release is available yet."
        : message)
    }
    return 1
  }
}
