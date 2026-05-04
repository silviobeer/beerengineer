import type { SupabaseAdapter, SupabaseWorkspaceContext } from "../../core/supabase/types.js"
import type { WaveDefinition } from "../../types.js"

export type SupabaseWaveProvisionResult = {
  dbRelevantWave: boolean
  provisioned: boolean
  reason?: string
}

export function isDbRelevantWave(wave: WaveDefinition): boolean {
  if (typeof wave.dbRelevantWave === "boolean") return wave.dbRelevantWave
  return wave.stories.some(story => story.dbRelevant === true)
}

export async function runSupabaseProvisionIfDbRelevant(
  wave: WaveDefinition,
  adapter: SupabaseAdapter,
  context: SupabaseWorkspaceContext,
): Promise<SupabaseWaveProvisionResult> {
  if (!isDbRelevantWave(wave)) {
    return { dbRelevantWave: false, provisioned: false, reason: "wave is not DB-relevant" }
  }

  await adapter.provisionBranch({ ...context, waveId: wave.id })
  return { dbRelevantWave: true, provisioned: true }
}
