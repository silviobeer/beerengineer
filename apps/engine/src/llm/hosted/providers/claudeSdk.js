import { sanitizePreviewValue } from "../../../core/messagePreview.js";
import { emitHostedThinking, emitHostedTokens, emitHostedToolCalled, emitHostedToolResult, } from "./_stream.js";
import { appendReplayMessages, makeReplaySession, readReplayMessages } from "./_sdkSession.js";
let cachedSdk;
async function loadAgentSdk() {
    if (cachedSdk !== undefined) {
        if (!cachedSdk)
            throw new Error(SDK_MISSING_MESSAGE);
        return cachedSdk;
    }
    try {
        // Dynamic import keeps CLI-only workspaces free of the SDK dependency.
        const mod = (await import("@anthropic-ai/claude-agent-sdk"));
        cachedSdk = (mod.default && typeof mod.default.query === "function" ? mod.default : mod);
        return cachedSdk;
    }
    catch {
        cachedSdk = null;
        throw new Error(SDK_MISSING_MESSAGE);
    }
}
const SDK_MISSING_MESSAGE = "claude:sdk requires @anthropic-ai/claude-agent-sdk. Install it (`npm i @anthropic-ai/claude-agent-sdk`) " +
    "or switch to a claude:cli profile.";
function ensureApiKey() {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("claude:sdk requires ANTHROPIC_API_KEY in the process environment. " +
            "Workspace .env.local discovery is not yet implemented — export the variable before invoking the engine.");
    }
}
/**
 * Map engine `RuntimePolicy` modes to Claude Agent SDK options. The mapping
 * deliberately mirrors the CLI equivalents in `claude.ts`; when the SDK lacks
 * an exact analogue we choose the stricter option, never broader.
 *
 * | policy mode               | CLI flag (today)                    | Agent SDK setting                 |
 * | ------------------------- | ----------------------------------- | --------------------------------- |
 * | no-tools                  | (none)                              | disallow all tools                |
 * | safe-readonly             | --permission-mode plan              | permission "plan", read-only tools|
 * | safe-workspace-write      | --permission-mode acceptEdits       | permission "acceptEdits"          |
 * | unsafe-autonomous-write   | --dangerously-skip-permissions      | permission "bypassPermissions"    |
 */
function policyToSdkOptions(input) {
    const opts = {
        model: input.runtime.model,
        cwd: input.runtime.workspaceRoot,
    };
    switch (input.runtime.policy.mode) {
        case "no-tools":
            // `tools: []` disables the entire built-in tool set; we still emit
            // `disallowedTools` defensively in case the SDK contract changes.
            opts.tools = [];
            opts.disallowedTools = ["*"];
            break;
        case "safe-readonly":
            opts.permissionMode = "plan";
            opts.allowedTools = ["Read", "Grep", "Glob"];
            break;
        case "safe-workspace-write":
            opts.permissionMode = "acceptEdits";
            break;
        case "unsafe-autonomous-write":
            opts.permissionMode = "bypassPermissions";
            // Required by the SDK alongside `bypassPermissions` — see Options docs.
            opts.allowDangerouslySkipPermissions = true;
            break;
    }
    if (input.session?.sessionId)
        opts.resume = input.session.sessionId;
    return opts;
}
function emptyState() {
    return {
        sessionId: null,
        resultText: null,
        fallbackTextParts: [],
        usage: null,
        toolCalls: new Map(),
        sawResult: false,
    };
}
function processEvent(event, state) {
    if (typeof event.session_id === "string")
        state.sessionId = event.session_id;
    if (event.type === "assistant" && event.message?.content) {
        state.usage = event.message.usage ?? state.usage;
        for (const part of event.message.content) {
            if (part.type === "text" && typeof part.text === "string") {
                state.fallbackTextParts.push(part.text);
            }
            else if (part.type === "tool_use" && typeof part.name === "string") {
                const argsPreview = sanitizePreviewValue(part.input);
                if (part.id)
                    state.toolCalls.set(part.id, { name: part.name, argsPreview });
                emitHostedToolCalled(part.name, argsPreview, "claude");
            }
            else if (part.type === "thinking" && typeof part.text === "string") {
                emitHostedThinking(sanitizePreviewValue(part.text) ?? part.text, "claude");
            }
        }
    }
    else if (event.type === "user" && event.message?.content) {
        for (const part of event.message.content) {
            if (part.type === "tool_result") {
                const call = part.tool_use_id ? state.toolCalls.get(part.tool_use_id) : undefined;
                emitHostedToolResult(call?.name ?? part.tool_use_id ?? "tool", call?.argsPreview, sanitizePreviewValue(part.content), "claude", part.is_error === true);
            }
        }
    }
    else if (event.type === "result") {
        state.sawResult = true;
        if (typeof event.result === "string")
            state.resultText = event.result;
        state.usage = event.usage ?? state.usage;
        // The SDK splits `result` events into success and error subtypes; both
        // carry `is_error`. Treat error results as fatal so the engine surfaces
        // a clear failure instead of swallowing the empty payload.
        if (event.is_error === true) {
            throw new Error(`claude:sdk result reported an error (subtype=${event.subtype ?? "?"})`);
        }
    }
    else if (event.type === "error") {
        throw new Error(`claude:sdk error: ${event.error ?? "unknown"}`);
    }
}
function finalText(state) {
    if (typeof state.resultText === "string")
        return state.resultText;
    if (state.fallbackTextParts.length > 0)
        return state.fallbackTextParts.join("");
    return "";
}
export async function invokeClaudeSdk(input) {
    ensureApiKey();
    const sdk = await loadAgentSdk();
    if (!sdk.query)
        throw new Error(SDK_MISSING_MESSAGE);
    const replayHistory = readReplayMessages(input.session);
    // When no server handle is available, prepend the persisted history as
    // assistant/user messages on top of the new prompt so the model sees the
    // full transcript. The stage payload still carries authoritative context.
    const promptParts = [];
    for (const msg of replayHistory) {
        promptParts.push(`[${msg.role}] ${msg.text}`);
    }
    promptParts.push(input.prompt);
    const fullPrompt = promptParts.join("\n\n");
    const state = emptyState();
    const events = sdk.query({ prompt: fullPrompt, options: policyToSdkOptions(input) });
    for await (const event of events) {
        processEvent(event, state);
    }
    const outputText = finalText(state);
    if (!state.sawResult && outputText.length === 0) {
        throw new Error("claude:sdk stream ended without a result event or recoverable assistant text");
    }
    emitHostedTokens(state.usage?.input_tokens ?? 0, state.usage?.output_tokens ?? 0, state.usage?.cache_read_input_tokens ?? 0, "claude", input.runtime.model);
    // If the SDK didn't return a server-side session handle, persist the
    // message exchange locally for the next step's replay.
    const baseSession = { harness: input.runtime.harness, sessionId: state.sessionId ?? input.session?.sessionId ?? null };
    const updatedHistory = state.sessionId
        ? []
        : appendReplayMessages(input.session, [
            { role: "user", text: input.prompt },
            { role: "assistant", text: outputText },
        ]);
    const session = state.sessionId
        ? makeReplaySession(baseSession, [], state.sessionId)
        : makeReplaySession(baseSession, updatedHistory, baseSession.sessionId);
    return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        command: ["@anthropic-ai/claude-agent-sdk"],
        outputText,
        session,
        cacheStats: {
            cachedInputTokens: state.usage?.cache_read_input_tokens ?? 0,
            totalInputTokens: state.usage?.input_tokens ?? 0,
        },
    };
}
