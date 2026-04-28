import { presentMessageEntry } from "../../core/messagePresentation.js";
import { buildConversation } from "../../core/conversation.js";
function s(value, fallback = "—") {
    return typeof value === "string" && value.trim() ? value : fallback;
}
function shortRunId(runId) {
    return runId.slice(0, 8);
}
const OPEN_PROMPT_SUMMARY_MAX_CHARS = 240;
function truncate(value, maxChars = OPEN_PROMPT_SUMMARY_MAX_CHARS) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
function joinTelegramLines(lines) {
    const filtered = lines.filter((line) => typeof line === "string" && line.trim().length > 0);
    return filtered.join("\n");
}
function promptContextForEntry(entry, repos) {
    if (entry.type === "prompt_requested") {
        return {
            promptId: typeof entry.payload.promptId === "string" ? entry.payload.promptId : null,
            text: typeof entry.payload.prompt === "string" ? entry.payload.prompt.trim() : null,
        };
    }
    if (!repos || entry.type !== "run_blocked")
        return { promptId: null, text: null };
    const conversation = buildConversation(repos, entry.runId);
    const openPrompt = conversation?.openPrompt;
    if (!openPrompt?.text?.trim())
        return { promptId: null, text: null };
    return {
        promptId: openPrompt.promptId,
        text: truncate(openPrompt.text.trim()),
    };
}
export function correlationKeyForMessage(entry) {
    switch (entry.type) {
        case "run_started":
        case "run_finished":
        case "run_failed":
        case "run_resumed":
            return `${entry.runId}:${entry.type}`;
        case "prompt_requested": {
            // Include promptId so multiple sequential prompts on the same run each
            // get their own delivery row — otherwise the PRIMARY KEY clash would
            // overwrite `telegram_message_id` and replies to older prompt messages
            // would fail correlation lookup.
            const promptId = typeof entry.payload.promptId === "string" ? entry.payload.promptId : entry.id;
            return `${entry.runId}:prompt_requested:${promptId}`;
        }
        case "run_blocked": {
            const scope = entry.payload.scope;
            if (typeof scope === "object" && scope !== null) {
                const record = scope;
                if (record.type === "story" && typeof record.waveNumber === "number" && typeof record.storyId === "string") {
                    return `${entry.runId}:${entry.type}:story:${record.waveNumber}:${record.storyId}`;
                }
                if (record.type === "stage" && typeof record.stageId === "string") {
                    return `${entry.runId}:${entry.type}:stage:${record.stageId}`;
                }
            }
            return `${entry.runId}:${entry.type}`;
        }
        case "phase_completed":
        case "phase_failed":
        case "phase_started":
            return `${entry.runId}:${entry.type}:${s(entry.payload.stageKey, entry.stageRunId ?? entry.id)}`;
        default:
            return `${entry.runId}:${entry.type}:${entry.id}`;
    }
}
function summaryHeader(presentation) {
    return `${presentation.icon} beerengineer_ ${presentation.label}`;
}
function renderPhaseStatusMessage(entry, presentation) {
    const failed = entry.type === "phase_failed";
    const stageKey = s(entry.payload.stageKey);
    return {
        text: joinTelegramLines([
            `${presentation.icon} beerengineer_ stage ${failed ? "failed" : "completed"}`,
            "",
            `Stage: ${stageKey}`,
            "",
            failed
                ? `${stageKey} hit trouble in run ${shortRunId(entry.runId)}.`
                : `${stageKey} is done in run ${shortRunId(entry.runId)}.`,
            failed ? "This stage needs attention." : "Another stage down.",
            typeof entry.payload.error === "string" ? `Error: ${entry.payload.error}` : undefined,
        ]),
        promptId: null,
    };
}
export function messageRoleForEntry(entry) {
    if (entry.type === "prompt_requested")
        return "prompt";
    if (entry.type === "run_started" ||
        entry.type === "phase_started" ||
        entry.type === "phase_completed" ||
        entry.type === "phase_failed" ||
        entry.type === "run_finished") {
        return "summary";
    }
    return "event";
}
export function describeChatMessage(entry, repos) {
    const prompt = promptContextForEntry(entry, repos);
    const presentation = presentMessageEntry(entry);
    switch (entry.type) {
        case "run_started":
            return {
                text: joinTelegramLines([
                    summaryHeader(presentation),
                    "",
                    `Heads up: ${s(entry.payload.title, entry.runId)} is underway.`,
                    `Run ${shortRunId(entry.runId)}`,
                    "",
                    "I’ll keep you posted when something interesting happens.",
                ]),
                promptId: null,
            };
        case "run_blocked":
            return {
                text: joinTelegramLines([
                    summaryHeader(presentation),
                    "",
                    `${s(entry.payload.title, entry.runId)} hit a blocker.`,
                    `Run ${shortRunId(entry.runId)}`,
                    "",
                    `What's stuck: ${s(entry.payload.summary)}`,
                    "",
                    prompt.text ? `Question: ${prompt.text}` : undefined,
                    prompt.text ? "Reply to answer and I’ll push it back into the run." : "Open the run for the next detail.",
                ]),
                promptId: prompt.promptId,
            };
        case "run_finished":
            return {
                text: joinTelegramLines([
                    summaryHeader(presentation),
                    "",
                    `${s(entry.payload.title, entry.runId)} is done.`,
                    `Run ${shortRunId(entry.runId)}`,
                    "",
                    entry.payload.status === "completed" ? "Nice. This one is wrapped up." : "This one ended rough.",
                    typeof entry.payload.error === "string" ? `Error: ${entry.payload.error}` : undefined,
                ]),
                promptId: null,
            };
        case "phase_started":
            return {
                text: joinTelegramLines([
                    `${presentation.icon} beerengineer_ stage started`,
                    "",
                    `Stage: ${s(entry.payload.stageKey)}`,
                    `Run ${shortRunId(entry.runId)}`,
                    "",
                    `${s(entry.payload.stageKey)} is up — working on it.`,
                ]),
                promptId: null,
            };
        case "phase_completed":
        case "phase_failed":
            return renderPhaseStatusMessage(entry, presentation);
        case "prompt_requested":
            return {
                text: joinTelegramLines([
                    `${presentation.icon} beerengineer_ needs an answer`,
                    "",
                    `Run ${shortRunId(entry.runId)}`,
                    "",
                    `Question: ${s(prompt.text ?? entry.payload.prompt)}`,
                    "",
                    "Reply to answer and I’ll feed it back into the run.",
                ]),
                promptId: prompt.promptId,
            };
        default:
            return null;
    }
}
export function renderChatMessage(entry, repos) {
    return describeChatMessage(entry, repos)?.text ?? null;
}
