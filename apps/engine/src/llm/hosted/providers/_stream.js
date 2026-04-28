import { emitEvent, getActiveRun } from "../../../core/runContext.js";
export function makeJsonLineStreamCallback(options) {
    return (line) => {
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            return;
        }
        options.onEvent?.(event);
        const summary = options.summarize(event);
        if (!summary)
            return;
        const active = getActiveRun();
        if (!active)
            return;
        emitEvent({
            type: "presentation",
            runId: active.runId,
            stageRunId: active.stageRunId ?? null,
            kind: summary.kind,
            text: summary.text,
        });
    };
}
export function emitHostedToolCalled(name, argsPreview, provider) {
    const active = getActiveRun();
    if (!active)
        return;
    emitEvent({
        type: "tool_called",
        runId: active.runId,
        stageRunId: active.stageRunId ?? null,
        name,
        argsPreview,
        provider,
    });
}
export function emitHostedToolResult(name, argsPreview, resultPreview, provider, isError = false) {
    const active = getActiveRun();
    if (!active)
        return;
    emitEvent({
        type: "tool_result",
        runId: active.runId,
        stageRunId: active.stageRunId ?? null,
        name,
        argsPreview,
        resultPreview,
        provider,
        isError,
    });
}
export function emitHostedThinking(text, provider, model) {
    const active = getActiveRun();
    if (!active || !text.trim())
        return;
    emitEvent({
        type: "llm_thinking",
        runId: active.runId,
        stageRunId: active.stageRunId ?? null,
        text: text.trim(),
        provider,
        model,
    });
}
export function emitHostedTokens(inputTokens, outputTokens, cached = 0, provider, model) {
    const active = getActiveRun();
    if (!active)
        return;
    emitEvent({
        type: "llm_tokens",
        runId: active.runId,
        stageRunId: active.stageRunId ?? null,
        in: inputTokens,
        out: outputTokens,
        cached,
        provider,
        model,
    });
}
export function emitRetryMarker(provider, attemptNumber, maxAttempts, delayMs) {
    const active = getActiveRun();
    if (!active)
        return;
    emitEvent({
        type: "presentation",
        runId: active.runId,
        stageRunId: active.stageRunId ?? null,
        kind: "dim",
        text: `${provider}: local retry ${attemptNumber}/${maxAttempts} in ${delayMs} ms`,
    });
}
