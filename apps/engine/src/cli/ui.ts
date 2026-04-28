import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const UI_DEV_HOST = "127.0.0.1"
const UI_DEV_PORT = 3100

export function resolveUiWorkspacePath(): string {
  return resolve(fileURLToPath(new URL("../../ui", import.meta.url)))
}

export function resolveUiLaunchUrl(): string {
  return `http://${UI_DEV_HOST}:${UI_DEV_PORT}`
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
