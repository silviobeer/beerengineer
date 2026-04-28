import { spawn } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Socket } from "node:net"

export type PreviewLaunchSource = "workspace-config" | "package-json"

export type PreviewLaunchSpec = {
  command: string
  cwd: string
  source: PreviewLaunchSource
}

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
    } catch {
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

export async function startPreviewServer(input: {
  worktreePath: string
  previewHost: string
  previewPort: number
}): Promise<{
  status: "started" | "already_running"
  launch: PreviewLaunchSpec
  logPath: string
}> {
  const launch = resolvePreviewLaunchSpec(input.worktreePath)
  if (!launch) throw new Error("preview_command_not_configured")
  if (await isPortListening(input.previewHost, input.previewPort)) {
    return {
      status: "already_running",
      launch,
      logPath: previewLogPath(input.worktreePath),
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
  closeSync(fd)
  child.unref()
  return {
    status: "started",
    launch,
    logPath,
  }
}
