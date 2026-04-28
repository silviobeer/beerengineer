import { attachCrossProcessBridge } from "./crossProcessBridge.js";
import { attachDbSync } from "./dbSync.js";
import { readWorkspaceConfig } from "./workspaces.js";
import { attachChatToolNotifications } from "../notifications/chattool/index.js";
import { defaultAppConfig, readConfigFile, resolveConfigPath, resolveMergedConfig, resolveOverrides, } from "../setup/config.js";
/**
 * Attach the standard three-subscriber stack (DB sync, chattool notifications,
 * cross-process bridge) to `bus` for the lifetime of a workflow run. Returns a
 * single `detach()` that tears all three down in reverse order. Used by both
 * `prepareRun` (fresh runs) and `performResume`.
 */
export function attachRunSubscribers(bus, repos, ctx, opts = {}) {
    const writtenLogIds = new Set();
    const overrides = resolveOverrides();
    const notificationConfig = resolveMergedConfig(readConfigFile(resolveConfigPath(overrides)), overrides) ?? defaultAppConfig();
    const detachDbSync = attachDbSync(bus, repos, ctx, { writtenLogIds, onItemColumnChanged: opts.onItemColumnChanged });
    const detachTelegram = attachChatToolNotifications(bus, repos, notificationConfig);
    const detachBridge = attachCrossProcessBridge(bus, repos, ctx.runId, { writtenLogIds });
    return () => {
        detachBridge();
        detachTelegram?.();
        detachDbSync();
    };
}
/**
 * Resolve `WorkflowLlmOptions` from a workspace row's on-disk config. Returns
 * undefined when the workspace has no `root_path` or the config is missing/invalid
 * — callers fall through to the fake-adapter path.
 */
export async function resolveWorkflowLlmOptions(workspaceRow) {
    const rootPath = workspaceRow?.root_path;
    if (!rootPath)
        return undefined;
    const workspaceConfig = await readWorkspaceConfig(rootPath);
    if (!workspaceConfig)
        return undefined;
    const stageConfig = {
        workspaceRoot: rootPath,
        harnessProfile: workspaceConfig.harnessProfile,
        runtimePolicy: workspaceConfig.runtimePolicy,
    };
    return {
        stage: stageConfig,
        execution: {
            stage: stageConfig,
            executionCoder: stageConfig,
        },
    };
}
