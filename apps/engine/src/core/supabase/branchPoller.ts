import { SupabaseManagementError } from "./managementClient.js"
import type { SupabaseBranch } from "./types.js"
import { parseRetryAfter } from "./retryAfter.js"

const PROVIDER_5XX_MAX_RETRIES = 3
const PROVIDER_5XX_BACKOFFS_MS = [250, 500, 1000]

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

export function isSupabaseBranchReady(branch: SupabaseBranch): boolean {
  return branch.status === "ACTIVE_HEALTHY" || branch.status === "FUNCTIONS_DEPLOYED"
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
  const isReady = input.isReady ?? isSupabaseBranchReady
  const startedAt = clock.now()
  const timeoutMs = input.timeoutMs ?? 10 * 60_000
  let delayMs = input.initialDelayMs ?? 5_000
  const maxDelayMs = input.maxDelayMs ?? 30_000
  let consecutive5xx = 0

  while (true) {
    try {
      const branch = await input.poll()
      if (isReady(branch)) return branch
      consecutive5xx = 0
    } catch (err) {
      // QA-020: retry transient provider 5xx with a short bounded backoff
      // before falling through to the regular polling cadence. Avoids
      // flaking the whole poll loop on a single momentary upstream blip.
      if (err instanceof SupabaseManagementError && err.kind === "provider" && typeof err.status === "number" && err.status >= 500) {
        if (consecutive5xx < PROVIDER_5XX_MAX_RETRIES) {
          const backoff = PROVIDER_5XX_BACKOFFS_MS[consecutive5xx] ?? PROVIDER_5XX_BACKOFFS_MS[PROVIDER_5XX_BACKOFFS_MS.length - 1]
          consecutive5xx += 1
          if (clock.now() - startedAt + backoff > timeoutMs) throw new SupabaseBranchPollTimeoutError()
          await clock.sleep(backoff)
          continue
        }
        throw err
      }
      if (!(err instanceof SupabaseManagementError && err.kind === "rate_limit" && err.retryAfter)) throw err
      // QA-027: parse Retry-After honoring both numeric and HTTP-date forms;
      // the parser clamps to a sane ceiling so a hostile/buggy header can't
      // sleep us past the overall poller budget.
      const retryMs = parseRetryAfter(err.retryAfter)
      if (retryMs !== null) {
        delayMs = Math.max(delayMs, retryMs)
      }
      consecutive5xx = 0
    }
    if (clock.now() - startedAt + delayMs > timeoutMs) throw new SupabaseBranchPollTimeoutError()
    await clock.sleep(delayMs)
    delayMs = Math.min(delayMs * 2, maxDelayMs)
  }
}
