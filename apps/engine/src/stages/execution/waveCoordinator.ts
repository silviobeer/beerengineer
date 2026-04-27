/**
 * WaveCoordinator — synchronisation primitive for the parallel-stories
 * runtime (BEERENGINEER_EXECUTION_PARALLEL_STORIES=1).
 *
 * The default execution path is sequential (Fix 1) and does not need this
 * file at all: every story branches off the freshly advanced wave HEAD.
 * Parallel mode reintroduces the merge-conflict-cascade risk because two
 * in-flight stories diverge from the same starting point. This coordinator
 * is the runtime hook that lets a story rebase onto wave HEAD between its
 * test+coder iterations, so it picks up a sibling's merged scaffold
 * without aborting mid-iteration.
 *
 * Design:
 *   - One coordinator per wave run.
 *   - The wave-merge path calls `notifyMergedStory(...)` after a successful
 *     `mergeStoryIntoWave`. That bumps the per-wave generation counter.
 *   - In-flight stories call `shouldRebase(storyId)` at iteration
 *     boundaries (between review cycles, never inside one). If their last
 *     seen generation < current, they should rebase.
 *   - On rebase success, the story records the new generation via
 *     `markRebased(storyId, generation)`.
 *   - On rebase conflict, the runtime calls `abandonStory(storyId, reason)`.
 *     Subsequent `shouldRebase` calls for that id always return false; the
 *     caller's outer loop is expected to terminate the story shortly.
 *
 * No mid-iteration rebase by design — that's user-visibly worse than the
 * current behavior because it can corrupt the in-progress coder state.
 */

export type WaveCoordinatorAbandonment = {
  storyId: string
  reason: string
}

export interface WaveCoordinator {
  /** Called by the wave-merge step after a successful story merge. */
  notifyMergedStory(storyId: string): void
  /**
   * Should this story rebase before its next test+coder cycle?
   * Returns true iff the wave HEAD has advanced since this story's last
   * recorded rebase generation (or since it joined the wave at gen 0).
   */
  shouldRebase(storyId: string): boolean
  /** Record that `storyId` has rebased onto the current wave generation. */
  markRebased(storyId: string): void
  /** Mark the story as abandoned; future `shouldRebase` calls return false. */
  abandonStory(storyId: string, reason: string): void
  /** All abandonments recorded so far, in order of registration. */
  abandonments(): WaveCoordinatorAbandonment[]
  /** Current generation counter (number of merges into the wave so far). */
  currentGeneration(): number
}

export function createWaveCoordinator(initialStoryIds: string[]): WaveCoordinator {
  let generation = 0
  // Each in-flight story remembers the generation it last rebased onto (or
  // joined at, which is generation 0). It needs to rebase iff the wave's
  // current generation is higher.
  const lastSeen = new Map<string, number>()
  for (const id of initialStoryIds) lastSeen.set(id, 0)
  const abandoned = new Map<string, string>()
  const abandonOrder: WaveCoordinatorAbandonment[] = []

  return {
    notifyMergedStory(storyId) {
      generation += 1
      // The merged story is no longer in-flight; remove it so it can't
      // accidentally try to rebase against itself.
      lastSeen.delete(storyId)
    },
    shouldRebase(storyId) {
      if (abandoned.has(storyId)) return false
      const seen = lastSeen.get(storyId)
      if (seen === undefined) return false
      return seen < generation
    },
    markRebased(storyId) {
      if (abandoned.has(storyId)) return
      lastSeen.set(storyId, generation)
    },
    abandonStory(storyId, reason) {
      if (abandoned.has(storyId)) return
      abandoned.set(storyId, reason)
      abandonOrder.push({ storyId, reason })
      lastSeen.delete(storyId)
    },
    abandonments() {
      return abandonOrder.slice()
    },
    currentGeneration() {
      return generation
    },
  }
}
