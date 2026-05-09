import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import type { ApiHttpShell, ApiRequestHandler } from "../src/api/entrypointContracts.js"
import { createApiLifecycleCoordinator } from "../src/api/lifecycleCoordinator.js"
import { composeApiPrivilegedDependencies } from "../src/api/privilegedDependencies.js"
import { registerApiRoutes } from "../src/api/routeRegistration.js"

test("REQ-10-2 wires the four API owners together through declared contracts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-api-entrypoint-owners-"))
  const originalEnv = {
    BEERENGINEER_UI_DB_PATH: process.env.BEERENGINEER_UI_DB_PATH,
    BEERENGINEER_CONFIG_PATH: process.env.BEERENGINEER_CONFIG_PATH,
    BEERENGINEER_DATA_DIR: process.env.BEERENGINEER_DATA_DIR,
    BEERENGINEER_SEED: process.env.BEERENGINEER_SEED,
  }
  process.env.BEERENGINEER_UI_DB_PATH = join(dir, "server.sqlite")
  process.env.BEERENGINEER_CONFIG_PATH = join(dir, "config.json")
  process.env.BEERENGINEER_DATA_DIR = join(dir, "data")
  process.env.BEERENGINEER_SEED = "0"

  const calls: string[] = []
  let boundHandler: ApiRequestHandler | null = null

  const shell: ApiHttpShell = {
    setRequestHandler(handler): void {
      boundHandler = handler
      calls.push("shell:set_request_handler")
    },
    async listen(onListening?: () => void): Promise<void> {
      calls.push("shell:listen")
      onListening?.()
    },
    async close(): Promise<Error | undefined> {
      calls.push("shell:close")
      return undefined
    },
    destroyTrackedSocketsAfter(delayMs: number): void {
      calls.push(`shell:destroy_after:${delayMs}`)
    },
    destroyTrackedSockets(): void {
      calls.push("shell:destroy_now")
    },
  }

  try {
    const dependencies = composeApiPrivilegedDependencies({
      host: "127.0.0.1",
      port: 4100,
      apiToken: "test-token",
    })

    const originalStartupRecovery = dependencies.lifecycleHooks.runStartupRecovery
    dependencies.lifecycleHooks.runStartupRecovery = async () => {
      calls.push("deps:startup_recovery")
      await originalStartupRecovery()
    }

    const originalExecutionTick = dependencies.lifecycleHooks.runExecutionOwnershipHandoffTick
    dependencies.lifecycleHooks.runExecutionOwnershipHandoffTick = async () => {
      calls.push("deps:handoff_tick")
      await originalExecutionTick()
    }

    const originalStartupCleanup = dependencies.lifecycleHooks.runStartupCleanupCatchup
    dependencies.lifecycleHooks.runStartupCleanupCatchup = async () => {
      calls.push("deps:startup_cleanup")
      await originalStartupCleanup()
    }

    const originalRecoverShutdown = dependencies.lifecycleHooks.recoverApiRunsForShutdown
    dependencies.lifecycleHooks.recoverApiRunsForShutdown = async () => {
      calls.push("deps:shutdown_recovery")
      await originalRecoverShutdown()
    }

    const originalCheckpointWal = dependencies.lifecycleHooks.checkpointWal
    dependencies.lifecycleHooks.checkpointWal = () => {
      calls.push("deps:checkpoint_wal")
      originalCheckpointWal()
    }

    const originalCloseDatabase = dependencies.lifecycleHooks.closeDatabase
    dependencies.lifecycleHooks.closeDatabase = () => {
      calls.push("deps:close_database")
      originalCloseDatabase()
    }

    dependencies.lifecycleHooks.removeEnginePidFile = () => {
      calls.push("deps:remove_pid_file")
    }

    dependencies.lifecycleHooks.exit = ((code: number) => {
      calls.push(`deps:exit:${code}`)
      throw new Error(`api-lifecycle-exit:${code}`)
    }) as (code: number) => never

    const lifecycle = createApiLifecycleCoordinator({
      shell,
      hooks: dependencies.lifecycleHooks,
      registerProcessHandlers: false,
      executionOwnershipHandoffMs: 60_000,
      cleanupMs: 60_000,
    })

    registerApiRoutes(shell, dependencies.routeDependencies, lifecycle)

    assert.ok(boundHandler, "route registration must attach a request handler to the shell contract")

    await lifecycle.start(() => {
      calls.push("lifecycle:listening")
    })

    await assert.rejects(
      lifecycle.requestShutdown("test"),
      /api-lifecycle-exit:0/,
    )

    assert.deepEqual(calls, [
      "shell:set_request_handler",
      "deps:startup_recovery",
      "deps:handoff_tick",
      "deps:startup_cleanup",
      "shell:listen",
      "lifecycle:listening",
      "shell:close",
      "shell:destroy_after:10000",
      "deps:shutdown_recovery",
      "deps:checkpoint_wal",
      "deps:close_database",
      "deps:remove_pid_file",
      "deps:exit:0",
    ])
  } finally {
    process.env.BEERENGINEER_UI_DB_PATH = originalEnv.BEERENGINEER_UI_DB_PATH
    process.env.BEERENGINEER_CONFIG_PATH = originalEnv.BEERENGINEER_CONFIG_PATH
    process.env.BEERENGINEER_DATA_DIR = originalEnv.BEERENGINEER_DATA_DIR
    process.env.BEERENGINEER_SEED = originalEnv.BEERENGINEER_SEED
    rmSync(dir, { recursive: true, force: true })
  }
})
