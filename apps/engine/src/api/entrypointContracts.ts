import type { IncomingMessage, ServerResponse } from "node:http"

import type { AppConfig } from "../setup/types.js"
import type { UpdateApplyResult } from "../core/updateMode.js"
import type { ItemActionEvent, ItemActionsService } from "../core/itemActions.js"
import type { SupabaseAdapter } from "../core/supabase/types.js"
import type { Repos } from "../db/repositories.js"
import type { Db } from "../db/connection.js"
import type { createBoardStream } from "./sse/boardStream.js"

export type ApiRequest = IncomingMessage & {
  repos?: Repos
  appConfig?: AppConfig
  executePreparedApply?: (prepared: UpdateApplyResult) => void
}

export type ApiRequestHandler = (
  req: ApiRequest,
  res: ServerResponse<IncomingMessage>
) => Promise<void> | void

export interface ApiHttpShell {
  setRequestHandler(handler: ApiRequestHandler): void
  listen(onListening?: () => void): Promise<void>
  close(): Promise<Error | undefined>
  destroyTrackedSocketsAfter(delayMs: number): void
  destroyTrackedSockets(): void
}

export interface ApiLifecycleView {
  isStartupRecoveryComplete(): boolean
  isShutdownInFlight(): boolean
  requestShutdown(reason: string): Promise<void>
}

export type ApiLifecycleHooks = {
  runStartupRecovery: () => Promise<void>
  runExecutionOwnershipHandoffTick: () => Promise<void>
  runStartupCleanupCatchup: () => Promise<void>
  runPeriodicCleanupTick: () => Promise<void>
  recoverApiRunsForShutdown: () => Promise<void>
  checkpointWal: () => void
  closeDatabase: () => void
  removeEnginePidFile: () => void
  exit: (code: number) => never
}

export type ApiRouteDependencies = {
  db: Db
  repos: Repos
  itemActions: ItemActionsService
  board: ReturnType<typeof createBoardStream>
  host: string
  port: number
  apiToken: string
  loadEffectiveConfig: () => AppConfig
  loadOpenApi: () => string | null
  executePreparedApply: (
    prepared: UpdateApplyResult,
    requestShutdown: (reason: string) => Promise<void>
  ) => void
  createSupabaseValidationAdapter: () => SupabaseAdapter
}

export type ApiShellBoundRoutes = {
  handle(req: ApiRequest, res: ServerResponse<IncomingMessage>): Promise<void>
}

export type ItemColumnChangedBroadcaster = (
  payload: Extract<ItemActionEvent, { type: "item_column_changed" }>
) => void
