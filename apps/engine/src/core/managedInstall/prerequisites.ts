import { spawnSync } from "node:child_process"
import { createManagedInstallPhase } from "./diagnostics.js"
import type { ManagedInstallPhase } from "./types.js"

type ProbeResult = {
  ok: boolean
  detail?: string
}

type ProbeCommand = (command: "node" | "npm" | "git") => Promise<ProbeResult>

const MIN_NODE_MAJOR = 22

export async function runManagedInstallPrerequisiteProbe(opts: {
  nodeVersion?: string
  probeCommand?: ProbeCommand
} = {}): Promise<ManagedInstallPhase> {
  const started = Date.now()
  const probeCommand = opts.probeCommand ?? defaultProbeCommand
  const failures: string[] = []
  const hints: string[] = []

  const node = await probeCommand("node")
  const npm = await probeCommand("npm")
  const git = await probeCommand("git")
  if (!node.ok) {
    failures.push("node")
    hints.push("Install Node.js 22 or newer and ensure `node` is on PATH.")
  }
  if (!npm.ok) {
    failures.push("npm")
    hints.push("Install npm and ensure `npm` is on PATH.")
  }
  if (!git.ok) {
    failures.push("git")
    hints.push("Install Git and ensure `git` is on PATH.")
  }

  const nodeVersion = opts.nodeVersion ?? process.version
  const nodeMajor = parseNodeMajor(nodeVersion)
  if (node.ok && nodeMajor < MIN_NODE_MAJOR) {
    failures.push(`Node.js >= ${MIN_NODE_MAJOR}`)
    hints.push("Install Node.js 22 or newer, then rerun the installer.")
  }

  if (failures.length > 0) {
    return createManagedInstallPhase({
      name: "prerequisites",
      status: "failed",
      message: `Missing or unsupported prerequisites: ${failures.join(", ")}`,
      fixHint: dedupe(hints).join(" "),
      durationMs: Date.now() - started,
    })
  }

  return createManagedInstallPhase({
    name: "prerequisites",
    status: "ok",
    message: "node, npm, and git are available",
    durationMs: Date.now() - started,
  })
}

async function defaultProbeCommand(command: "node" | "npm" | "git"): Promise<ProbeResult> {
  try {
    const result = spawnSync(command, ["--version"], { encoding: "utf8" })
    return {
      ok: result.status === 0,
      detail: result.stdout.trim() || result.stderr.trim(),
    }
  } catch (err) {
    return { ok: false, detail: (err as Error).message }
  }
}

function parseNodeMajor(version: string): number {
  const match = version.match(/v?(\d+)/)
  return match ? Number(match[1]) : 0
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}
