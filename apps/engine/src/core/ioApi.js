import { EventEmitter } from "node:events";
import { createBus, busToWorkflowIO } from "./bus.js";
import { withPromptPersistence } from "./promptPersistence.js";
/**
 * Build a bus-backed IO session with prompt persistence attached, plus an
 * EventEmitter bridge for legacy SSE glue. Production run hosting uses
 * `core/runService.ts → buildApiIo`; this helper stays because the test
 * suite exercises the bus + persistence wiring through it, and the
 * `ioContract` test checks that it implements `WorkflowIO`.
 */
export function createApiIOSession(repos) {
    const bus = createBus();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    const detachPersistence = withPromptPersistence(bus, repos);
    const detachBridge = bus.subscribe((event) => {
        emitter.emit("event", event);
    });
    const io = busToWorkflowIO(bus);
    return {
        io,
        emitter,
        bus,
        answerPrompt(promptId, answer) {
            return bus.answer(promptId, answer);
        },
        dispose() {
            detachBridge();
            detachPersistence();
            bus.close();
            emitter.removeAllListeners();
        },
    };
}
