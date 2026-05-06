import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { AppConfig } from "../setup/types.js"

const UI_DEV_HOST = process.env.BEERENGINEER_UI_HOST ?? "0.0.0.0"
const UI_DEV_PORT = 3100
const SERVICE_WAIT_MS = 12_000

export type SetupServiceStatus = "running" | "started" | "unavailable"

export type SetupLaunchResult = {
  engine: {
    status: SetupServiceStatus
    url: string
    detail?: string
  }
  ui: {
    status: SetupServiceStatus
    url: string
    detail?: string
  }
  setupUrl: string
  browser: {
    status: "opened" | "printed"
    detail?: string
  }
}

function hostnameFromPublicBaseUrl(): string | null {
  const raw = process.env.BEERENGINEER_PUBLIC_BASE_URL?.trim()
  if (!raw) return null
  try {
    return new URL(raw).hostname || null
  } catch {
    return null
  }
}

function lanHostname(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address
    }
  }
  return null
}

export function resolveUiWorkspacePath(): string {
  return resolve(fileURLToPath(new URL("../../../ui", import.meta.url)))
}

export function resolveUiLaunchUrl(): string {
  const displayHost = hostnameFromPublicBaseUrl() ?? (UI_DEV_HOST === "0.0.0.0" ? (lanHostname() ?? "127.0.0.1") : UI_DEV_HOST)
  return `http://${displayHost}:${UI_DEV_PORT}`
}

export function resolveSetupLaunchUrl(config?: Pick<AppConfig, "publicBaseUrl">): string {
  const configured = config?.publicBaseUrl?.trim()
  const base = configured || resolveUiLaunchUrl()
  return `${base.replace(/\/+$/, "")}/setup`
}

export function resolveEngineLaunchUrl(config: Pick<AppConfig, "enginePort">): string {
  return `http://127.0.0.1:${config.enginePort}`
}

function resolveUiProbeUrl(): string {
  return `http://127.0.0.1:${UI_DEV_PORT}`
}

async function urlResponds(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url)
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

async function waitForUrl(url: string, timeoutMs = SERVICE_WAIT_MS, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await urlResponds(url, fetchImpl)) return true
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  return false
}

async function ensureEngineForSetup(config: Pick<AppConfig, "enginePort">): Promise<SetupLaunchResult["engine"]> {
  const url = resolveEngineLaunchUrl(config)
  if (await urlResponds(`${url}/health`)) return { status: "running", url }

  const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "../api", "server.ts")
  try {
    const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(config.enginePort),
      },
    })
    child.unref()
  } catch (err) {
    return { status: "unavailable", url, detail: (err as Error).message }
  }

  return (await waitForUrl(`${url}/health`))
    ? { status: "started", url }
    : { status: "unavailable", url, detail: "Engine did not answer before setup timeout." }
}

async function ensureUiForSetup(): Promise<SetupLaunchResult["ui"]> {
  const uiDir = resolveUiWorkspacePath()
  const url = resolveUiLaunchUrl()
  const probeUrl = resolveUiProbeUrl()
  if (await urlResponds(probeUrl)) return { status: "running", url }
  if (!existsSync(resolve(uiDir, "package.json"))) {
    return { status: "unavailable", url, detail: "UI workspace is not available in this checkout." }
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  try {
    const child = spawn(npm, ["run", "dev", "--", "--hostname", UI_DEV_HOST, "--port", String(UI_DEV_PORT)], {
      cwd: uiDir,
      detached: true,
      stdio: "ignore",
    })
    child.unref()
  } catch (err) {
    return { status: "unavailable", url, detail: (err as Error).message }
  }

  return (await waitForUrl(probeUrl))
    ? { status: "started", url }
    : { status: "unavailable", url, detail: "UI did not answer before setup timeout." }
}

function isHeadlessEnvironment(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CI) return "CI environment detected."
  if (env.SSH_TTY || env.SSH_CONNECTION) return "SSH session detected."
  if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return "No graphical display detected."
  if (existsSync("/.dockerenv")) return "Container environment detected."
  return null
}

function openSetupUrl(url: string): SetupLaunchResult["browser"] {
  const headless = isHeadlessEnvironment()
  if (headless) return { status: "printed", detail: headless }

  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  const result = spawnSync(command, args, { stdio: "ignore", timeout: 5_000 })
  if (result.status === 0 && !result.error) return { status: "opened" }
  return {
    status: "printed",
    detail: result.error?.message ?? "Browser opener was not available.",
  }
}

export async function launchSetupExperience(config: Pick<AppConfig, "enginePort" | "publicBaseUrl">): Promise<SetupLaunchResult> {
  const engine = await ensureEngineForSetup(config)
  const ui = await ensureUiForSetup()
  const setupUrl = resolveSetupLaunchUrl(config)
  const browser = ui.status === "unavailable"
    ? { status: "printed" as const, detail: ui.detail ?? "UI is not available." }
    : openSetupUrl(setupUrl)
  return { engine, ui, setupUrl, browser }
}

export function startUi(): Promise<number> {
  const uiDir = resolveUiWorkspacePath()
  if (!existsSync(resolve(uiDir, "package.json"))) {
    console.error("  UI is not currently part of this repo (apps/ui was removed 2026-04-24).")
    console.error("  See specs/ui-rebuild-plan.md — a fresh UI is pending a separate plan.")
    return Promise.resolve(1)
  }

  const uiUrl = resolveUiLaunchUrl()
  console.log(`  Starting UI dev server in ${uiDir}`)
  console.log(`  Opening ${uiUrl}\n`)
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const child = spawn(npm, ["run", "dev", "--", "--hostname", UI_DEV_HOST, "--port", String(UI_DEV_PORT)], {
    cwd: uiDir,
    stdio: "inherit"
  })

  return new Promise((resolvePromise) => {
    const forceTimer = (): void => {
      setTimeout(() => child.kill("SIGKILL"), 1500).unref?.()
    }
    const forward = (signal: NodeJS.Signals) => {
      child.kill(signal)
      forceTimer()
    }
    const cleanup = () => {
      process.off("SIGINT", forward)
      process.off("SIGTERM", forward)
    }
    process.on("SIGINT", forward)
    process.on("SIGTERM", forward)
    child.on("exit", (code) => {
      cleanup()
      resolvePromise(code ?? 0)
    })
    child.on("error", (err) => {
      cleanup()
      console.error(`  Failed to start UI: ${err.message}`)
      resolvePromise(1)
    })
  })
}

export function startEngine(): Promise<number> {
  const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "../api", "server.ts")
  console.log(`  Starting engine API from ${serverEntry}`)
  const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    stdio: "inherit",
    env: process.env,
  })

  return new Promise((resolvePromise) => {
    const forceTimer = (): void => {
      setTimeout(() => child.kill("SIGKILL"), 1500).unref?.()
    }
    const forward = (signal: NodeJS.Signals) => {
      child.kill(signal)
      forceTimer()
    }
    const cleanup = () => {
      process.off("SIGINT", forward)
      process.off("SIGTERM", forward)
    }
    process.on("SIGINT", forward)
    process.on("SIGTERM", forward)
    child.on("exit", code => {
      cleanup()
      resolvePromise(code ?? 0)
    })
    child.on("error", err => {
      cleanup()
      console.error(`  Failed to start engine: ${err.message}`)
      resolvePromise(1)
    })
  })
}
