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
export function createWaveCoordinator(initialStoryIds) {
    let generation = 0;
    // Each in-flight story remembers the generation it last rebased onto (or
    // joined at, which is generation 0). It needs to rebase iff the wave's
    // current generation is higher.
    const lastSeen = new Map();
    for (const id of initialStoryIds)
        lastSeen.set(id, 0);
    const abandoned = new Map();
    const abandonOrder = [];
    return {
        notifyMergedStory(storyId) {
            generation += 1;
            // The merged story is no longer in-flight; remove it so it can't
            // accidentally try to rebase against itself.
            lastSeen.delete(storyId);
        },
        shouldRebase(storyId) {
            if (abandoned.has(storyId))
                return false;
            const seen = lastSeen.get(storyId);
            if (seen === undefined)
                return false;
            return seen < generation;
        },
        markRebased(storyId) {
            if (abandoned.has(storyId))
                return;
            lastSeen.set(storyId, generation);
        },
        abandonStory(storyId, reason) {
            if (abandoned.has(storyId))
                return;
            abandoned.set(storyId, reason);
            abandonOrder.push({ storyId, reason });
            lastSeen.delete(storyId);
        },
        abandonments() {
            return abandonOrder.slice();
        },
        currentGeneration() {
            return generation;
        },
    };
}
