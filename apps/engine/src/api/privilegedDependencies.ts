import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { initDatabase } from "../db/connection.js"
import { Repos } from "../db/repositories.js"
import { createItemActionsService, type ItemActionEvent } from "../core/itemActions.js"
import { createSupabaseAdapter } from "../core/supabase/adapter.js"
import { SupabaseManagementClient } from "../core/supabase/managementClient.js"
import {
  defaultAppConfig,
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
} from "../setup/config.js"
import type { AppConfig } from "../setup/types.js"
import { createBoardStream } from "./sse/boardStream.js"
import { seedIfEmpty } from "./seed.js"
import { removeEnginePidFile } from "./pidFile.js"
import { recoverApiRunsForShutdown, recoverLostWorkerRuns } from "../core/orphanRecovery.js"
import { API_WORKER_INSTANCE_ID, resumeRunFromExistingRemediationInProcess, autoResumeRunOnStartup } from "../core/runService.js"
import { claimExecutionOwnershipHandoffs } from "../core/executionOwnershipHandoff.js"
import { pruneMissingWorktreeAssignments } from "../core/portAllocator.js"
import { markPreparedUpdateInFlight, releaseUpdateLock, type UpdateApplyResult } from "../core/updateMode.js"
import { readActiveSecretValue } from "../setup/secretStore.js"
import { SUPABASE_MANAGEMENT_TOKEN_SECRET_REF } from "../setup/secretMetadata.js"
import { runStartupCleanupCatchup } from "../core/supabase/cleanupCatchup.js"
import {
  primeCodexSandboxCapabilityDetection,
  setCodexSandboxCapabilityStore,
} from "../llm/hosted/providers/codexSandboxPolicy.js"
import { getWorkerAdmissionController, workerAdmissionStartupLogMessage } from "../core/workerAdmission.js"
import type { ApiLifecycleHooks, ApiRouteDependencies } from "./entrypointContracts.js"

const OPENAPI_PATH = resolvePath(dirname(fileURLToPath(import.meta.url)), "openapi.json")

export function loadEffectiveConfig(): AppConfig {
  const overrides = resolveOverrides()
  return resolveMergedConfig(readConfigFile(resolveConfigPath(overrides)), overrides)
    ?? defaultAppConfig()
}

export function exportPublicBaseUrlFromConfig(): void {
  if (process.env.BEERENGINEER_PUBLIC_BASE_URL?.trim()) return
  try {
    const config = loadEffectiveConfig()
    const fromConfig = config?.publicBaseUrl?.trim()
    if (fromConfig) process.env.BEERENGINEER_PUBLIC_BASE_URL = fromConfig
  } catch {
    // missing or malformed config — `setup` will surface the warning elsewhere
  }
}

type ComposeApiPrivilegedDependenciesOptions = {
  host: string
  port: number
  apiToken: string
}

type ApiPrivilegedDependencies = {
  routeDependencies: ApiRouteDependencies
  lifecycleHooks: ApiLifecycleHooks
}

export function composeApiPrivilegedDependencies(
  options: ComposeApiPrivilegedDependenciesOptions,
): ApiPrivilegedDependencies {
  let cachedOpenApi: string | null = null
  const loadOpenApi = (): string | null => {
    if (cachedOpenApi !== null) return cachedOpenApi
    try {
      cachedOpenApi = readFileSync(OPENAPI_PATH, "utf8")
    } catch {
      cachedOpenApi = null
    }
    return cachedOpenApi
  }

  const db = initDatabase()
  const repos = new Repos(db)
  setCodexSandboxCapabilityStore({
    load: () => repos.getCodexSandboxCapabilitySnapshot()?.capability ?? "unknown",
    persist: capability => {
      repos.setCodexSandboxCapabilitySnapshot(capability)
    },
  })
  const admission = getWorkerAdmissionController(repos)
  const itemActions = createItemActionsService(repos)
  const board = createBoardStream(repos, db)

  console.log(workerAdmissionStartupLogMessage(admission.resolution))

  seedIfEmpty(db, repos)

  itemActions.on("event", (ev: ItemActionEvent) => {
    if (ev.type === "item_column_changed") {
      board.broadcastItemColumnChanged({
        itemId: ev.itemId,
        from: ev.from,
        to: ev.to,
        phaseStatus: ev.phaseStatus,
      })
    }
  })

  const executePreparedApply = (
    prepared: UpdateApplyResult,
    requestShutdown: (reason: string) => Promise<void>,
  ): void => {
    try {
      if (!existsSync(prepared.switcherPath)) {
        throw new Error("prepared_switcher_missing")
      }
      const managedCurrent = join(loadEffectiveConfig().dataDir, "install", "current", "apps", "engine", "bin", "update-backup.js")
      if (!existsSync(managedCurrent)) {
        console.error("[update] leaving apply attempt queued; managed install/current is not active yet")
        return
      }
      const marked = markPreparedUpdateInFlight(repos, prepared.operationId)
      if (!marked) {
        throw new Error("update_attempt_not_queued")
      }
      const child = spawn(prepared.switcherPath, [], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      })
      child.unref()
      void requestShutdown(`update:${prepared.operationId}`)
    } catch (err) {
      releaseUpdateLock(loadEffectiveConfig(), prepared.operationId)
      repos.upsertUpdateAttempt({
        operationId: prepared.operationId,
        kind: "apply",
        status: "failed-no-rollback",
        errorMessage: (err as Error).message,
        completedAt: Date.now(),
        metadataJson: JSON.stringify({
          switcherPath: prepared.switcherPath,
          metadataPath: prepared.metadataPath,
          failedDuring: "engine_handoff",
        }),
      })
      console.error(`[update] apply execution handoff failed: ${(err as Error).message}`)
    }
  }

  const createSupabaseValidationAdapter = () => {
    const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF) ?? ""
    return createSupabaseAdapter({ repos, client: new SupabaseManagementClient({ token }) })
  }

  const routeDependencies: ApiRouteDependencies = {
    db,
    repos,
    itemActions,
    board,
    host: options.host,
    port: options.port,
    apiToken: options.apiToken,
    loadEffectiveConfig,
    loadOpenApi,
    executePreparedApply,
    createSupabaseValidationAdapter,
  }

  const lifecycleHooks: ApiLifecycleHooks = {
    async runStartupRecovery(): Promise<void> {
      try {
        await primeCodexSandboxCapabilityDetection()
        const config = loadEffectiveConfig()
        const autoResumeOverride = process.env.BEERENGINEER_STARTUP_AUTO_RESUME?.trim().toLowerCase()
        const autoResumeEnabled = autoResumeOverride != null
          ? ["1", "true", "yes", "on"].includes(autoResumeOverride)
          : config.recovery?.startupAutoResume !== false
        await recoverLostWorkerRuns(repos, {
          apiWorkerInstanceId: API_WORKER_INSTANCE_ID,
          autoResume: {
            enabled: autoResumeEnabled,
            recoveryThreshold: admission.resolution.effectiveWorkerCap,
            resumeRun: async run => {
              const result = await autoResumeRunOnStartup(repos, {
                runId: run.id,
                summary: "Startup auto-resumed the stale run after confirming no human input is pending.",
                apiWorkerInstanceId: API_WORKER_INSTANCE_ID,
                onItemColumnChanged: payload => board.broadcastItemColumnChanged(payload),
              })
              if (!result.ok) throw new Error(result.error)
            },
          },
        })
      } catch (err) {
        console.error("[orphanRecovery] startup scan failed:", (err as Error).message)
      }
    },
    async runExecutionOwnershipHandoffTick(): Promise<void> {
      try {
        await claimExecutionOwnershipHandoffs(repos, {
          apiWorkerInstanceId: API_WORKER_INSTANCE_ID,
          onItemColumnChanged: payload => board.broadcastItemColumnChanged(payload),
          resumeRun: (claimRepos, input) => resumeRunFromExistingRemediationInProcess(claimRepos, {
            remediationId: input.remediationId,
            apiWorkerInstanceId: input.apiWorkerInstanceId,
            workerLeaseClock: input.workerLeaseClock,
            workerLeaseScheduler: input.workerLeaseScheduler,
            onItemColumnChanged: input.onItemColumnChanged,
          }),
        })
      } catch (err) {
        console.error("[executionOwnershipHandoff] poll failed:", (err as Error).message)
      }
    },
    async runStartupCleanupCatchup(): Promise<void> {
      pruneMissingWorktreeAssignments()
      try {
        const catchupSummaries = await runStartupCleanupCatchup({
          repos,
          db,
          adapterFor: ({ supabaseProjectRef }) => {
            const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF) ?? ""
            if (!token) return null
            return createSupabaseAdapter({ repos, client: new SupabaseManagementClient({ token }) })
          },
        })
        const total = catchupSummaries.reduce((n, s) => n + s.processed, 0)
        console.error(`[supabase] startup cleanup catch-up complete: ${catchupSummaries.length} workspace(s), ${total} branch(es) processed`)
      } catch (err) {
        console.error("[supabase] startup cleanup catch-up failed:", (err as Error).message)
      }
    },
    async runPeriodicCleanupTick(): Promise<void> {
      try {
        await runStartupCleanupCatchup({
          repos,
          db,
          adapterFor: ({ supabaseProjectRef: _ref }) => {
            const token = readActiveSecretValue(SUPABASE_MANAGEMENT_TOKEN_SECRET_REF) ?? ""
            if (!token) return null
            return createSupabaseAdapter({ repos, client: new SupabaseManagementClient({ token }) })
          },
        })
      } catch (err) {
        console.error("[supabase] periodic cleanup tick failed:", (err as Error).message)
      }
    },
    async recoverApiRunsForShutdown(): Promise<void> {
      try {
        await recoverApiRunsForShutdown(repos, { apiWorkerInstanceId: API_WORKER_INSTANCE_ID })
      } catch (err) {
        console.error("[orphanRecovery] graceful shutdown scan failed:", (err as Error).message)
      }
    },
    checkpointWal(): void {
      try {
        db.pragma("wal_checkpoint(TRUNCATE)")
      } catch (err) {
        console.error("[engine] wal checkpoint during shutdown failed:", (err as Error).message)
      }
    },
    closeDatabase(): void {
      try {
        board.dispose()
      } catch {
        // best-effort cleanup before DB close
      }
      try {
        admission.dispose()
      } catch {
        // best-effort cleanup before DB close
      }
      try {
        db.close()
      } catch (err) {
        console.error("[engine] db close during shutdown failed:", (err as Error).message)
      }
    },
    removeEnginePidFile,
    exit: code => process.exit(code),
  }

  return { routeDependencies, lifecycleHooks }
}
