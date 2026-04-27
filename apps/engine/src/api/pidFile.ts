import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"

export type EnginePidRecord = {
  pid: number
  host: string
  port: number
  startedAt: string
}

function defaultPidPath(): string {
  const envPath = process.env.BEERENGINEER_ENGINE_PID_FILE
  if (envPath) return resolve(envPath)
  const xdgState = process.env.XDG_STATE_HOME
  const base = xdgState ? resolve(xdgState) : join(homedir(), ".local", "state")
  return join(base, "beerengineer", "engine.pid")
}

export function resolveEnginePidFilePath(): string {
  return defaultPidPath()
}

export function writeEnginePidFile(record: EnginePidRecord): string {
  const path = defaultPidPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  return path
}

export function readEnginePidFile(): EnginePidRecord | null {
  try {
    return JSON.parse(readFileSync(defaultPidPath(), "utf8")) as EnginePidRecord
  } catch {
    return null
  }
}

export function removeEnginePidFile(): void {
  try {
    rmSync(defaultPidPath(), { force: true })
  } catch {}
}
