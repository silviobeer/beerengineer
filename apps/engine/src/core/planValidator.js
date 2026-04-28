/**
 * Planner post-validator: enforces the file-overlap invariant that
 * makes `internallyParallelizable: true` *safe*.
 *
 * Why this exists
 * ---------------
 * The planner's job is to assign stories to waves and decide which waves
 * can fan out. When two stories in the same wave both edit the same
 * shared file (package.json, design-tokens.css, package-lock.json,
 * tsconfig, etc.) and the wave is marked `internallyParallelizable: true`,
 * the parallel runtime will produce two divergent scaffolds and the
 * merge resolver cannot reconcile them — the HelloWorld run blocked
 * exactly here.
 *
 * The validator runs after planning, before execution, and:
 *   - reads `sharedFiles` from each feature wave's stories
 *   - if any pair of stories in a parallel-eligible wave shares a file,
 *     overrides `internallyParallelizable` to `false`
 *   - if a story is missing `sharedFiles` (or empty), treats it as
 *     "unknown overlap" → also forces sequential, because we'd rather
 *     ship correctness than throughput
 *   - emits the canonical `wave_serialized` event for every override so
 *     operators see why the planner's parallel hint was downgraded
 *
 * Setup waves are not affected: `internallyParallelizable` is always
 * `false` for setup waves (the planner is required to emit it that way),
 * and setup tasks are an integration boundary by construction.
 */
import { emitEvent } from "./runContext.js";
function collectStoryFiles(stories) {
    const filesByStory = new Map();
    let anyMissing = false;
    for (const story of stories) {
        const declared = Array.isArray(story.sharedFiles) ? story.sharedFiles : null;
        if (!declared || declared.length === 0) {
            anyMissing = true;
            filesByStory.set(story.id, new Set());
            continue;
        }
        filesByStory.set(story.id, new Set(declared));
    }
    return { filesByStory, anyMissing };
}
function findOverlappingFiles(wave) {
    // Setup waves are out of scope — they always run sequentially.
    if (wave.kind === "setup")
        return null;
    const stories = wave.stories ?? [];
    if (stories.length < 2)
        return null;
    // Story id → set of declared shared files. A story with `undefined` or
    // `[]` is "unknown overlap": we cannot prove non-overlap, so we treat
    // it as colliding with every other story below.
    const { filesByStory, anyMissing } = collectStoryFiles(stories);
    if (anyMissing) {
        return { stories: stories.map(s => s.id), overlap: [] };
    }
    const overlap = new Set();
    const ids = stories.map(s => s.id);
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            addStoryPairOverlap(filesByStory, ids[i], ids[j], overlap);
        }
    }
    if (overlap.size === 0)
        return null;
    return { stories: ids, overlap: Array.from(overlap).sort((left, right) => left.localeCompare(right)) };
}
function addStoryPairOverlap(filesByStory, leftId, rightId, overlap) {
    const left = filesByStory.get(leftId);
    const right = filesByStory.get(rightId);
    if (!left || !right)
        return;
    for (const file of left) {
        if (right.has(file))
            overlap.add(file);
    }
}
/**
 * Walk every feature wave in the plan; if a wave is marked parallel-
 * eligible but its stories declare shared-file collisions (or a story
 * is missing `sharedFiles` so we cannot rule one out), rewrite the wave
 * to `internallyParallelizable: false` and return the decision.
 *
 * Mutates `plan.plan.waves[*].internallyParallelizable` in place — the
 * caller is expected to persist the artifact afterwards. Returns the
 * list of waves that were downgraded so the caller can log/audit.
 */
export function enforceWaveParallelism(plan, opts = {}) {
    const decisions = [];
    const waves = plan.plan?.waves;
    if (!Array.isArray(waves))
        return decisions;
    for (const wave of waves) {
        if (!wave.internallyParallelizable)
            continue;
        if (wave.kind === "setup") {
            // Defensive: planner contract says setup waves are never parallel.
            // If one slips through, downgrade silently — no event needed.
            wave.internallyParallelizable = false;
            continue;
        }
        const found = findOverlappingFiles(wave);
        if (!found)
            continue;
        const cause = found.overlap.length === 0
            ? "missing_shared_files"
            : "shared_file_overlap";
        wave.internallyParallelizable = false;
        const decision = {
            waveNumber: wave.number,
            waveId: wave.id,
            stories: found.stories,
            overlappingFiles: found.overlap,
            cause,
        };
        decisions.push(decision);
        const emit = opts.emit ?? ((event) => {
            // Try to emit through the runContext bus; outside an active run
            // (e.g. in unit tests with no IO scope) this throws. Swallow that
            // so the validator stays a pure function for non-runtime callers.
            try {
                emitEvent(event);
            }
            catch {
                // no active workflow IO — fall through, decisions[] is the
                // structured signal callers should use anyway.
            }
        });
        emit({
            type: "wave_serialized",
            runId: opts.runId ?? "",
            waveId: wave.id,
            waveNumber: wave.number,
            stories: found.stories,
            overlappingFiles: found.overlap,
            cause,
        });
    }
    return decisions;
}
