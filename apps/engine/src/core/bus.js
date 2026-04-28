import { EventEmitter } from "node:events";
import { getActiveRun } from "./runContext.js";
let counter = 0;
function newPromptId() {
    counter += 1;
    return `p-${Date.now().toString(36)}-${counter.toString(36)}`;
}
export function createBus() {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    const pending = new Map();
    const emit = (event) => {
        emitter.emit("event", event);
        // Resolve any pending `request()` whose promptId matches. Any subscriber
        // that wants to answer a prompt just emits `prompt_answered` — no
        // separate signalling mechanism is needed.
        if (event.type === "prompt_answered") {
            const request = pending.get(event.promptId);
            if (request) {
                pending.delete(event.promptId);
                request.resolve(event.answer);
            }
        }
    };
    const subscribe = (listener) => {
        emitter.on("event", listener);
        return () => emitter.off("event", listener);
    };
    const request = async (prompt, opts) => {
        const promptId = opts?.promptId ?? newPromptId();
        const active = getActiveRun();
        const runId = opts?.runId ?? active?.runId ?? "no-run";
        const stageRunId = opts?.stageRunId ?? active?.stageRunId ?? null;
        return new Promise(resolve => {
            pending.set(promptId, { resolve, runId });
            emit({
                type: "prompt_requested",
                runId,
                promptId,
                prompt,
                actions: opts?.actions,
                stageRunId,
            });
        });
    };
    const answer = (promptId, answer) => {
        const request = pending.get(promptId);
        if (!request)
            return false;
        emit({
            type: "prompt_answered",
            runId: request.runId,
            promptId,
            answer,
        });
        return true;
    };
    const close = () => {
        for (const request of pending.values())
            request.resolve("");
        pending.clear();
        emitter.removeAllListeners();
    };
    return { emit, subscribe, request, answer, close };
}
/**
 * Adapt a bus to the legacy `WorkflowIO` shape. `ask` routes through the
 * bus's request/answer cycle; `emit` is a thin pass-through. The returned
 * io also exposes `.bus` so orchestrators can attach subscribers.
 */
export function hasEventBus(io) {
    return "bus" in io;
}
export function busToWorkflowIO(bus) {
    return {
        ask: (prompt, opts) => bus.request(prompt, opts),
        emit: (event) => bus.emit(event),
        close: () => bus.close(),
        bus,
    };
}
