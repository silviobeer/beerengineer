import type { ApiHttpShell, ApiLifecycleHooks, ApiLifecycleView } from "./entrypointContracts.js"

type CreateApiLifecycleCoordinatorOptions = {
  shell: ApiHttpShell
  hooks: ApiLifecycleHooks
  registerProcessHandlers?: boolean
  executionOwnershipHandoffMs?: number
  cleanupMs?: number
}

type ApiLifecycleCoordinator = ApiLifecycleView & {
  start(onListening?: () => void): Promise<void>
}

export function createApiLifecycleCoordinator(
  options: CreateApiLifecycleCoordinatorOptions,
): ApiLifecycleCoordinator {
  const registerProcessHandlers = options.registerProcessHandlers ?? true
  const executionOwnershipHandoffMs = options.executionOwnershipHandoffMs ?? 1_000
  const cleanupMs = options.cleanupMs ?? 5 * 60_000

  let startupRecoveryComplete = false
  let shutdownInFlight = false
  let executionOwnershipHandoffPoller: NodeJS.Timeout | null = null
  let cleanupTick: NodeJS.Timeout | null = null

  const requestShutdown = async (reason: string): Promise<void> => {
    if (shutdownInFlight) return
    shutdownInFlight = true
    if (executionOwnershipHandoffPoller) clearInterval(executionOwnershipHandoffPoller)
    if (cleanupTick) clearInterval(cleanupTick)
    console.error(`[engine] graceful shutdown requested: ${reason}`)
    const closePromise = options.shell.close()
    options.shell.destroyTrackedSocketsAfter(10_000)
    await options.hooks.recoverApiRunsForShutdown()
    const closeErr = await closePromise
    if (closeErr) console.error("[engine] server close error:", closeErr.message)
    options.hooks.checkpointWal()
    options.hooks.closeDatabase()
    options.hooks.removeEnginePidFile()
    options.hooks.exit(closeErr ? 1 : 0)
  }

  const registerHandlers = (): void => {
    process.on("SIGTERM", () => void requestShutdown("sigterm"))
    process.on("SIGINT", () => void requestShutdown("sigint"))
    process.on("unhandledRejection", reason => {
      console.error("[engine] unhandled rejection:", reason)
    })
    process.on("uncaughtException", err => {
      console.error("[engine] uncaught exception:", err)
      void requestShutdown("uncaughtException")
    })
  }

  return {
    async start(onListening?: () => void): Promise<void> {
      await options.hooks.runStartupRecovery()
      startupRecoveryComplete = true

      await options.hooks.runExecutionOwnershipHandoffTick()
      executionOwnershipHandoffPoller = setInterval(() => {
        void options.hooks.runExecutionOwnershipHandoffTick()
      }, executionOwnershipHandoffMs)
      executionOwnershipHandoffPoller.unref?.()

      await options.hooks.runStartupCleanupCatchup()
      cleanupTick = setInterval(() => {
        void options.hooks.runPeriodicCleanupTick()
      }, cleanupMs)
      cleanupTick.unref?.()

      if (registerProcessHandlers) registerHandlers()
      await options.shell.listen(onListening)
    },
    isStartupRecoveryComplete(): boolean {
      return startupRecoveryComplete
    },
    isShutdownInFlight(): boolean {
      return shutdownInFlight
    },
    requestShutdown,
  }
}
