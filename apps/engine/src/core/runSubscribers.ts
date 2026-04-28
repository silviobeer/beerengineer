import type { EventBus } from "./bus.js"
import { attachCrossProcessBridge } from "./crossProcessBridge.js"
import { attachDbSync } from "./dbSync.js"
import { readWorkspaceConfig } from "./workspaces.js"
import type { Repos, WorkspaceRow } from "../db/repositories.js"
import { attachChatToolNotifications } from "../notifications/chattool/index.js"
import {
  defaultAppConfig,
  readConfigFile,
  resolveConfigPath,
  resolveMergedConfig,
  resolveOverrides,
} from "../setup/config.js"
import type { WorkflowLlmOptions } from "../workflow.js"

/**
 * Attach the standard three-subscriber stack (DB sync, chattool notifications,
 * cross-process bridge) to `bus` for the lifetime of a workflow run. Returns a
 * single `detach()` that tears all three down in reverse order. Used by both
 * `prepareRun` (fresh runs) and `performResume`.
 */
export function attachRunSubscribers(
  bus: EventBus,
  repos: Repos,
  ctx: { runId: string; itemId: string },
  opts: {
    /**
     * Called after every authoritative `setItemColumn` write. The API server
     * passes `board.broadcastItemColumnChanged` here so workflow-driven column
     * transitions produce an `item_column_changed` SSE frame just like
     * operator-driven transitions do. Optional — CLI path leaves it undefined.
     */
    onItemColumnChanged?: (payload: { itemId: string; from: string; to: string; phaseStatus: string }) => void
  } = {},
): () => void {
  const writtenLogIds = new Set<string>()
  const overrides = resolveOverrides()
  const notificationConfig =
    resolveMergedConfig(readConfigFile(resolveConfigPath(overrides)), overrides) ?? defaultAppConfig()

  const detachDbSync = attachDbSync(bus, repos, ctx, { writtenLogIds, onItemColumnChanged: opts.onItemColumnChanged })
  const detachTelegram = attachChatToolNotifications(bus, repos, notificationConfig)
  const detachBridge = attachCrossProcessBridge(bus, repos, ctx.runId, { writtenLogIds })

  return () => {
    detachBridge()
    detachTelegram?.()
    detachDbSync()
  }
}

/**
 * Resolve `WorkflowLlmOptions` from a workspace row's on-disk config. Returns
 * undefined when the workspace has no `root_path` or the config is missing/invalid
 * — callers fall through to the fake-adapter path.
 */
export async function resolveWorkflowLlmOptions(
  workspaceRow: Pick<WorkspaceRow, "root_path"> | undefined,
): Promise<WorkflowLlmOptions | undefined> {
  const rootPath = workspaceRow?.root_path
  if (!rootPath) return undefined
  const workspaceConfig = await readWorkspaceConfig(rootPath)
  if (!workspaceConfig) return undefined
  const stageConfig = {
    workspaceRoot: rootPath,
    harnessProfile: workspaceConfig.harnessProfile,
    runtimePolicy: workspaceConfig.runtimePolicy,
  }
  return {
    stage: stageConfig,
    execution: {
      stage: stageConfig,
      executionCoder: stageConfig,
    },
  }
}
