import type { RunRow } from "../db/repositories.js"

export const LOST_WORKER_USER_MESSAGE = "Worker lost. Resume this run to continue."

export function recoveryUserMessageForRun(
  run: Pick<RunRow, "recovery_status" | "recovery_summary">,
): string | null {
  if (run.recovery_status !== "failed") return null
  const summary = run.recovery_summary?.toLowerCase() ?? ""
  const workerLossSignals = [
    "lost api worker",
    "cli worker heartbeat is stale",
    "worker heartbeat",
    "worker start failed",
    "graceful shutdown stopped the api worker",
    "no live worker",
  ]
  return workerLossSignals.some(signal => summary.includes(signal))
    ? LOST_WORKER_USER_MESSAGE
    : null
}
