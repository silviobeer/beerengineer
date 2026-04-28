import { AsyncLocalStorage } from "node:async_hooks";
export function parsePromptActions(value) {
    if (!Array.isArray(value))
        return undefined;
    const actions = value
        .filter((entry) => {
        return typeof entry === "object" &&
            entry !== null &&
            typeof entry.label === "string" &&
            typeof entry.value === "string";
    })
        .map(entry => ({ label: entry.label, value: entry.value }));
    return actions.length > 0 ? actions : undefined;
}
const workflowIOStorage = new AsyncLocalStorage();
export function runWithWorkflowIO(io, fn) {
    return workflowIOStorage.run(io, fn);
}
export function getWorkflowIO() {
    const io = workflowIOStorage.getStore();
    if (!io) {
        throw new Error("WorkflowIO not set — wrap the workflow with runWithWorkflowIO()");
    }
    return io;
}
export function hasWorkflowIO() {
    return workflowIOStorage.getStore() !== undefined;
}
