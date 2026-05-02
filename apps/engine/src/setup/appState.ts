import { existsSync, mkdirSync } from "node:fs"
import { initDatabase } from "../db/connection.js"
import {
  readConfigFile,
  resolveConfigPath,
  resolveConfiguredDbPath,
  resolveMergedConfig,
  resolveOverrides,
  writeConfigFile,
} from "./config.js"
import type { AppConfig, SetupOverrides } from "./types.js"

export type AppStateInitResult =
  | {
      ok: true
      config: AppConfig
      configPath: string
      dataDir: string
      dbPath: string
      configState: "created" | "unchanged"
      dataDirState: "created" | "existing"
      databaseState: "created" | "existing"
    }
  | {
      ok: false
      reason: "invalid_config"
      configPath: string
      error: string
    }

export function initializeAppState(overrides: SetupOverrides = {}): AppStateInitResult {
  const resolved = resolveOverrides(overrides)
  const configPath = resolveConfigPath(resolved)
  const state = readConfigFile(configPath)
  if (state.kind === "invalid") {
    return { ok: false, reason: "invalid_config", configPath: state.path, error: state.error }
  }

  const config = resolveMergedConfig(state, resolved)
  if (!config) {
    return {
      ok: false,
      reason: "invalid_config",
      configPath,
      error: "effective config could not be resolved",
    }
  }

  const dataDirExisted = existsSync(config.dataDir)
  mkdirSync(config.dataDir, { recursive: true })

  const dbPath = resolveConfiguredDbPath(config)
  const dbExisted = existsSync(dbPath)
  initDatabase(dbPath).close()

  if (state.kind === "missing") {
    writeConfigFile(configPath, config)
  }

  return {
    ok: true,
    config,
    configPath,
    dataDir: config.dataDir,
    dbPath,
    configState: state.kind === "missing" ? "created" : "unchanged",
    dataDirState: dataDirExisted ? "existing" : "created",
    databaseState: dbExisted ? "existing" : "created",
  }
}
