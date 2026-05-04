import type { SupabaseAdapter, SupabaseWorkspaceContext } from "./types.js"

export type WaveProvisionResult =
  | { ok: true; provisioned: boolean; events: string[] }
  | { ok: false; error: string }

export async function provisionWaveIfDbRelevant(input: {
  dbRelevantWave: boolean
  existingBranchRef?: string | null
  adapter: Pick<SupabaseAdapter, "provisionBranch">
  context: SupabaseWorkspaceContext
  dispatchWorker?: () => void
}): Promise<WaveProvisionResult> {
  // Internal ordering markers for tests; these are not WorkflowEvent names.
  const events: string[] = []
  if (!input.dbRelevantWave || input.existingBranchRef) {
    input.dispatchWorker?.()
    return { ok: true, provisioned: false, events }
  }
  events.push("orchestration:provision_branch")
  const result = await input.adapter.provisionBranch(input.context)
  if (!result.ok) return { ok: false, error: String(result.context?.message ?? result.context?.error ?? "provision_failed") }
  input.dispatchWorker?.()
  events.push("orchestration:dispatch_worker")
  return { ok: true, provisioned: true, events }
}
