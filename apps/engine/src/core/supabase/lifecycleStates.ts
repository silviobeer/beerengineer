export const SUPABASE_LIFECYCLE_STATES = [
  "provisioning",
  "ready",
  "validating",
  "validated",
  "retained-pending-cleanup",
  "failed",
  "retained-for-diagnosis",
  "quota-exceeded",
  "destroying",
  "destroyed",
] as const

export type SupabaseLifecycleState = typeof SUPABASE_LIFECYCLE_STATES[number]

export function retainForDiagnosis(reason: "failed" | "timeout" | "aborted"): SupabaseLifecycleState {
  void reason
  return "retained-for-diagnosis"
}

export function canAutoCleanup(state: SupabaseLifecycleState): boolean {
  return state !== "retained-for-diagnosis"
}
