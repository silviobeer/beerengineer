import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Socket } from "node:net"

export type PreviewLaunchSource = "workspace-config" | "package-json"

export type PreviewLaunchSpec = {
  command: string
  cwd: string
  source: PreviewLaunchSource
}

const PREVIEW_READY_TIMEOUT_MS = 5000
const PREVIEW_READY_POLL_MS = 125

type PackageJsonShape = {
  packageManager?: unknown
  scripts?: Record<string, unknown>
}

function inferPackageManager(worktreePath: string, pkg: PackageJsonShape): "npm" | "pnpm" | "yarn" | "bun" {
  const packageManager = typeof pkg.packageManager === "string" ? pkg.packageManager : ""
  if (packageManager.startsWith("pnpm@")) return "pnpm"
  if (packageManager.startsWith("yarn@")) return "yarn"
  if (packageManager.startsWith("bun@")) return "bun"
  if (packageManager.startsWith("npm@")) return "npm"
  if (existsSync(join(worktreePath, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(worktreePath, "yarn.lock"))) return "yarn"
  if (existsSync(join(worktreePath, "bun.lock")) || existsSync(join(worktreePath, "bun.lockb"))) return "bun"
  return "npm"
}

function commandFromPackageManager(pm: "npm" | "pnpm" | "yarn" | "bun"): string {
  switch (pm) {
    case "pnpm":
      return "pnpm run dev"
    case "yarn":
      return "yarn dev"
    case "bun":
      return "bun run dev"
    default:
      return "npm run dev"
  }
}

function resolvePreviewCwd(worktreePath: string, rawCwd: string | undefined): string {
  const base = resolve(worktreePath)
  const target = rawCwd ? resolve(base, rawCwd) : base
  if (target !== base && !target.startsWith(`${base}/`)) {
    throw new Error("preview_command_cwd_invalid")
  }
  return target
}

export function resolvePreviewLaunchSpec(worktreePath: string): PreviewLaunchSpec | null {
  const workspaceConfigPath = join(worktreePath, ".beerengineer", "workspace.json")
  if (existsSync(workspaceConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(workspaceConfigPath, "utf8")) as {
        preview?: { command?: unknown; cwd?: unknown }
      }
      if (typeof raw.preview?.command === "string" && raw.preview.command.trim().length > 0) {
        return {
          command: raw.preview.command.trim(),
          cwd: resolvePreviewCwd(worktreePath, typeof raw.preview.cwd === "string" ? raw.preview.cwd : undefined),
          source: "workspace-config",
        }
      }
    } catch (error) {
      if ((error as Error).message === "preview_command_cwd_invalid") throw error
      // Fall through to package.json detection.
    }
  }

  const packageJsonPath = join(worktreePath, "package.json")
  if (!existsSync(packageJsonPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJsonShape
    if (typeof pkg.scripts?.dev !== "string" || pkg.scripts.dev.trim().length === 0) return null
    const manager = inferPackageManager(worktreePath, pkg)
    return {
      command: commandFromPackageManager(manager),
      cwd: resolve(worktreePath),
      source: "package-json",
    }
  } catch {
    return null
  }
}

export function previewLogPath(worktreePath: string): string {
  return join(worktreePath, ".beerengineer-preview.log")
}

export function previewPidPath(worktreePath: string): string {
  return join(worktreePath, ".beerengineer-preview.pid")
}

export function readManagedPreviewPid(worktreePath: string): number | null {
  const path = previewPidPath(worktreePath)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, "utf8").trim()
    const pid = Number(raw)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function writeManagedPreviewPid(worktreePath: string, pid: number): void {
  writeFileSync(previewPidPath(worktreePath), `${pid}\n`)
}

function clearManagedPreviewPid(worktreePath: string): void {
  try {
    rmSync(previewPidPath(worktreePath), { force: true })
  } catch {
    // Best effort cleanup only.
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPreviewLogTail(logPath: string, maxChars = 400): string | undefined {
  if (!existsSync(logPath)) return undefined
  try {
    const text = readFileSync(logPath, "utf8")
    const trimmed = text.trim()
    if (!trimmed) return undefined
    return trimmed.slice(-maxChars)
  } catch {
    return undefined
  }
}

export async function isPortListening(host: string, port: number): Promise<boolean> {
  return await new Promise(resolvePromise => {
    const socket = new Socket()
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(value)
    }
    socket.setTimeout(700)
    socket.once("connect", () => settle(true))
    socket.once("timeout", () => settle(false))
    socket.once("error", () => settle(false))
    socket.connect(port, host)
  })
}

async function waitForPortListening(host: string, port: number, timeoutMs = PREVIEW_READY_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortListening(host, port)) return true
    await new Promise(resolvePromise => setTimeout(resolvePromise, PREVIEW_READY_POLL_MS))
  }
  return await isPortListening(host, port)
}

async function waitForPreviewReady(
  child: ChildProcess,
  host: string,
  port: number,
  timeoutMs = PREVIEW_READY_TIMEOUT_MS,
): Promise<"listening" | "exited"> {
  let exited = false
  const onExit = () => {
    exited = true
  }
  child.once("exit", onExit)
  child.once("error", onExit)
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await isPortListening(host, port)) return "listening"
      if (exited || child.exitCode !== null) return "exited"
      await new Promise(resolvePromise => setTimeout(resolvePromise, PREVIEW_READY_POLL_MS))
    }
    return (await isPortListening(host, port)) ? "listening" : "exited"
  } finally {
    child.off("exit", onExit)
    child.off("error", onExit)
  }
}

export async function startPreviewServer(input: {
  worktreePath: string
  previewHost: string
  previewPort: number
}): Promise<{
  status: "started" | "already_running"
  launch: PreviewLaunchSpec
  logPath: string
  pid: number | null
}> {
  const launch = resolvePreviewLaunchSpec(input.worktreePath)
  if (!launch) throw new Error("preview_command_not_configured")
  const existingPid = readManagedPreviewPid(input.worktreePath)
  if (existingPid != null && !isProcessAlive(existingPid)) {
    clearManagedPreviewPid(input.worktreePath)
  }
  if (await isPortListening(input.previewHost, input.previewPort)) {
    return {
      status: "already_running",
      launch,
      logPath: previewLogPath(input.worktreePath),
      pid: readManagedPreviewPid(input.worktreePath),
    }
  }

  mkdirSync(launch.cwd, { recursive: true })
  const logPath = previewLogPath(input.worktreePath)
  const fd = openSync(logPath, "a")
  const child = spawn(launch.command, {
    cwd: launch.cwd,
    detached: true,
    shell: true,
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      PORT: String(input.previewPort),
      BEERENGINEER_PREVIEW_PORT: String(input.previewPort),
      BEERENGINEER_PREVIEW_HOST: input.previewHost,
      BEERENGINEER_PREVIEW_URL: `http://${input.previewHost}:${input.previewPort}`,
    },
  })
  if (typeof child.pid === "number" && child.pid > 0) {
    writeManagedPreviewPid(input.worktreePath, child.pid)
  }
  closeSync(fd)
  const ready = await waitForPreviewReady(child, input.previewHost, input.previewPort)
  child.unref()
  if (ready !== "listening") {
    clearManagedPreviewPid(input.worktreePath)
    const tail = readPreviewLogTail(logPath)
    const detail = tail ? `; log tail: ${tail}` : ""
    throw new Error(`preview_failed_to_listen${detail}`)
  }
  return {
    status: "started",
    launch,
    logPath,
    pid: child.pid ?? null,
  }
}

async function waitForPreviewStopped(host: string, port: number, timeoutMs = PREVIEW_READY_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isPortListening(host, port))) return true
    await new Promise(resolvePromise => setTimeout(resolvePromise, PREVIEW_READY_POLL_MS))
  }
  return !(await isPortListening(host, port))
}

export async function stopPreviewServer(input: {
  worktreePath: string
  previewHost: string
  previewPort: number
}): Promise<{
  status: "stopped" | "already_stopped"
  logPath: string
  pid: number | null
}> {
  const pid = readManagedPreviewPid(input.worktreePath)
  const logPath = previewLogPath(input.worktreePath)
  const listening = await isPortListening(input.previewHost, input.previewPort)
  if (pid == null) {
    if (!listening) {
      clearManagedPreviewPid(input.worktreePath)
      return { status: "already_stopped", logPath, pid: null }
    }
    throw new Error("preview_running_but_unmanaged")
  }
  if (!isProcessAlive(pid)) {
    clearManagedPreviewPid(input.worktreePath)
    return { status: "already_stopped", logPath, pid }
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    process.kill(pid, "SIGTERM")
  }
  if (!(await waitForPreviewStopped(input.previewHost, input.previewPort))) {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      process.kill(pid, "SIGKILL")
    }
    if (!(await waitForPreviewStopped(input.previewHost, input.previewPort))) {
      throw new Error("preview_failed_to_stop")
    }
  }
  clearManagedPreviewPid(input.worktreePath)
  return { status: "stopped", logPath, pid }
}
