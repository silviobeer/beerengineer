import { sanitizePreviewValue } from "../../../core/messagePreview.js";
import { emitHostedThinking, emitHostedTokens, emitHostedToolCalled, emitHostedToolResult, } from "./_stream.js";
import { appendReplayMessages, makeReplaySession, readReplayMessages } from "./_sdkSession.js";
let cachedSdkCtor;
async function loadCodexSdk() {
    if (cachedSdkCtor !== undefined) {
        if (!cachedSdkCtor)
            throw new Error(SDK_MISSING_MESSAGE);
        return cachedSdkCtor;
    }
    try {
        // Dynamic import keeps CLI-only workspaces free of the SDK dependency.
        const mod = (await import("@openai/codex-sdk"));
        cachedSdkCtor = mod.Codex;
        return cachedSdkCtor;
    }
    catch {
        cachedSdkCtor = null;
        throw new Error(SDK_MISSING_MESSAGE);
    }
}
const SDK_MISSING_MESSAGE = "codex:sdk requires @openai/codex-sdk. Install it (`npm i @openai/codex-sdk`) " +
    "or switch to a codex:cli profile.";
function ensureApiKey() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("codex:sdk requires OPENAI_API_KEY in the process environment. " +
            "Workspace .env.local discovery is not yet implemented — export the variable before invoking the engine.");
    }
}
/**
 * Map engine `RuntimePolicy` to Codex SDK `ThreadOptions`. Mirrors the CLI
 * sandbox/approval flags in `codex.ts`. When the SDK lacks a clean analogue,
 * we pick the stricter setting, never broader.
 */
function policyToThreadOptions(input) {
    const opts = {
        model: input.runtime.model,
        workingDirectory: input.runtime.workspaceRoot,
        skipGitRepoCheck: true,
    };
    switch (input.runtime.policy.mode) {
        case "no-tools":
        case "safe-readonly":
            opts.sandboxMode = "read-only";
            opts.approvalPolicy = "never";
            break;
        case "safe-workspace-write":
            opts.sandboxMode = "workspace-write";
            opts.approvalPolicy = "never";
            break;
        case "unsafe-autonomous-write":
            opts.sandboxMode = "danger-full-access";
            opts.approvalPolicy = "never";
            break;
    }
    return opts;
}
function emptyState() {
    return {
        sessionId: null,
        finalAgentText: null,
        fallbackTextParts: [],
        usage: null,
        sawCompleted: false,
    };
}
function processEvent(event, state) {
    if (event.type === "thread.started") {
        state.sessionId = event.thread_id;
    }
    else if (event.type === "turn.completed") {
        state.sawCompleted = true;
        state.usage = event.usage;
    }
    else if (event.type === "turn.failed") {
        throw new Error(`codex:sdk turn failed: ${event.error.message}`);
    }
    else if (event.type === "error") {
        throw new Error(`codex:sdk error: ${event.message}`);
    }
    else if (event.type === "item.completed" || event.type === "item.started" || event.type === "item.updated") {
        const item = event.item;
        if (event.type === "item.completed" && item.type === "agent_message") {
            // Codex emits the assistant's final text as an `agent_message` item.
            // Capturing the latest one matches the CLI's `--output-last-message`.
            state.finalAgentText = item.text;
            state.fallbackTextParts.push(item.text);
        }
        else if (item.type === "reasoning" && (event.type === "item.started" || event.type === "item.completed")) {
            emitHostedThinking(sanitizePreviewValue(item.text) ?? item.text, "codex");
        }
        else if (item.type === "command_execution") {
            if (event.type === "item.started") {
                emitHostedToolCalled("Bash", sanitizePreviewValue(item.command), "codex");
            }
            else if (event.type === "item.completed") {
                emitHostedToolResult("Bash", sanitizePreviewValue(item.command), sanitizePreviewValue(item.aggregated_output), "codex", item.status === "failed");
            }
        }
        else if (item.type === "file_change" && event.type === "item.completed") {
            emitHostedToolResult("Edit", sanitizePreviewValue(item.changes.map(c => `${c.kind} ${c.path}`).join(", ")), undefined, "codex", item.status === "failed");
        }
        else if (item.type === "mcp_tool_call" && event.type === "item.started") {
            emitHostedToolCalled(`${item.server}/${item.tool}`, sanitizePreviewValue(item.arguments), "codex");
        }
        else if (item.type === "mcp_tool_call" && event.type === "item.completed") {
            emitHostedToolResult(`${item.server}/${item.tool}`, sanitizePreviewValue(item.arguments), sanitizePreviewValue(item.result?.content ?? item.error?.message), "codex", item.status === "failed");
        }
    }
}
function finalText(state) {
    if (typeof state.finalAgentText === "string")
        return state.finalAgentText;
    if (state.fallbackTextParts.length > 0)
        return state.fallbackTextParts.join("");
    return "";
}
export async function invokeCodexSdk(input) {
    ensureApiKey();
    const Codex = await loadCodexSdk();
    // Replay any persisted local history for SDK runtimes — the Codex SDK
    // returns a server-side handle on first turn (`thread_id`), but we still
    // want a deterministic prompt history on the local side as a fallback.
    const replayHistory = readReplayMessages(input.session);
    const promptParts = [];
    for (const msg of replayHistory)
        promptParts.push(`[${msg.role}] ${msg.text}`);
    promptParts.push(input.prompt);
    const fullPrompt = promptParts.join("\n\n");
    const codex = new Codex({ apiKey: process.env.OPENAI_API_KEY });
    const threadOptions = policyToThreadOptions(input);
    const thread = input.session?.sessionId
        ? codex.resumeThread(input.session.sessionId, threadOptions)
        : codex.startThread(threadOptions);
    const state = emptyState();
    const turn = await thread.runStreamed(fullPrompt);
    for await (const event of turn.events) {
        processEvent(event, state);
    }
    if (!state.sawCompleted && state.finalAgentText === null && state.fallbackTextParts.length === 0) {
        throw new Error("codex:sdk turn ended without a turn.completed event or any agent_message");
    }
    const outputText = finalText(state);
    emitHostedTokens(state.usage?.input_tokens ?? 0, state.usage?.output_tokens ?? 0, state.usage?.cached_input_tokens ?? 0, "codex", input.runtime.model);
    const baseSession = {
        harness: input.runtime.harness,
        sessionId: state.sessionId ?? thread.id ?? input.session?.sessionId ?? null,
    };
    const updatedHistory = baseSession.sessionId
        ? []
        : appendReplayMessages(input.session, [
            { role: "user", text: input.prompt },
            { role: "assistant", text: outputText },
        ]);
    const session = baseSession.sessionId
        ? makeReplaySession(baseSession, [], baseSession.sessionId)
        : makeReplaySession(baseSession, updatedHistory, null);
    return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        command: ["@openai/codex-sdk"],
        outputText,
        session,
        cacheStats: {
            cachedInputTokens: state.usage?.cached_input_tokens ?? 0,
            totalInputTokens: state.usage?.input_tokens ?? 0,
        },
    };
}
