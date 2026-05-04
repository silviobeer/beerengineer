import { SupabaseManagementError } from "./managementClient.js"
import type { SupabaseBranch } from "./types.js"

export class SupabaseBranchPollTimeoutError extends Error {
  constructor(message = "Supabase branch polling timed out") {
    super(message)
    this.name = "SupabaseBranchPollTimeoutError"
  }
}

export type BranchPollerClock = {
  now(): number
  sleep(ms: number): Promise<void>
}

export async function pollSupabaseBranch(input: {
  poll(): Promise<SupabaseBranch>
  isReady?: (branch: SupabaseBranch) => boolean
  clock?: BranchPollerClock
  initialDelayMs?: number
  maxDelayMs?: number
  timeoutMs?: number
}): Promise<SupabaseBranch> {
  const clock = input.clock ?? { now: () => Date.now(), sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)) }
  const isReady = input.isReady ?? ((branch: SupabaseBranch) => branch.status === "ACTIVE_HEALTHY")
  const startedAt = clock.now()
  const timeoutMs = input.timeoutMs ?? 10 * 60_000
  let delayMs = input.initialDelayMs ?? 5_000
  const maxDelayMs = input.maxDelayMs ?? 30_000

  while (true) {
    try {
      const branch = await input.poll()
      if (isReady(branch)) return branch
    } catch (err) {
      if (!(err instanceof SupabaseManagementError && err.kind === "rate_limit" && err.retryAfter)) throw err
      const retryMs = Number(err.retryAfter) * 1_000
      delayMs = Math.max(delayMs, Number.isFinite(retryMs) ? retryMs : delayMs)
    }
    if (clock.now() - startedAt + delayMs > timeoutMs) throw new SupabaseBranchPollTimeoutError()
    await clock.sleep(delayMs)
    delayMs = Math.min(delayMs * 2, maxDelayMs)
  }
}
