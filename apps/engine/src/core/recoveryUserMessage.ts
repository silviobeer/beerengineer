import type { RunRow } from "../db/repositories.js"
import { parseSupabaseProvisioningRecoveryPayload } from "./supabase/recoveryPayload.js"
import { SUPABASE_PROVISIONING_RECOVERY_USER_MESSAGE } from "./supabase/provisioningRecovery.js"

export const LOST_WORKER_USER_MESSAGE = "Worker lost. Resume this run to continue."

export function recoveryUserMessageForRun(
  run: Pick<RunRow, "recovery_status" | "recovery_summary" | "recovery_payload_json">,
): string | null {
  if (run.recovery_status === "blocked") {
    const payload = parseSupabaseProvisioningRecoveryPayload(run.recovery_payload_json)
    if (payload) return payload.userMessage || SUPABASE_PROVISIONING_RECOVERY_USER_MESSAGE
  }
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
