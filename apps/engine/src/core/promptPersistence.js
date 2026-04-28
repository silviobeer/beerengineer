/**
 * Subscribe a prompt-persistence middleware to the bus:
 *  - on `prompt_requested`, upsert a `pending_prompts` row for the event's
 *    promptId + runId (idempotent: re-emits don't create duplicates).
 *  - on `prompt_answered`, mark the matching row as answered.
 *
 * This replaces the duplicate prompt/answer mirroring that used to live in
 * both the CLI adapter (`ioCli`) and the HTTP-side run service.
 *
 * Returns the unsubscribe function.
 */
export function withPromptPersistence(bus, repos) {
    return bus.subscribe(event => {
        try {
            if (event.type === "prompt_requested") {
                if (!repos.getRun(event.runId)) {
                    return;
                }
                const existing = repos.getPendingPrompt(event.promptId);
                if (!existing) {
                    repos.createPendingPrompt({
                        id: event.promptId,
                        runId: event.runId,
                        stageRunId: event.stageRunId ?? null,
                        prompt: event.prompt,
                        actions: event.actions,
                    });
                }
                return;
            }
            if (event.type === "prompt_answered") {
                repos.answerPendingPrompt(event.promptId, event.answer);
            }
        }
        catch (err) {
            process.stderr.write(`[prompt-persistence] ${err.message}\n`);
        }
    });
}
