import { presentMessageEntry } from "./messagePresentation.js";
export function renderMessageEntry(entry) {
    const presentation = presentMessageEntry(entry);
    return presentation.detail
        ? `${presentation.icon} ${presentation.label}  ${presentation.detail}`
        : `${presentation.icon} ${presentation.label}`;
}
export function terminalExitCodeForEntry(entry) {
    switch (entry.type) {
        case "run_blocked":
            return 11;
        case "run_failed":
        case "phase_failed":
            return 10;
        case "run_finished":
            return entry.payload.status === "failed" ? 10 : 0;
        default:
            return null;
    }
}
