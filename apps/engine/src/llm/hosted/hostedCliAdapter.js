import { emitEvent, getActiveRun } from "../../core/runContext.js";
import { buildReviewPrompt, buildStagePrompt } from "./promptEnvelope.js";
import { mapReviewEnvelopeToResponse, mapStageEnvelopeToResponse, } from "./outputEnvelope.js";
import { invokeClaude } from "./providers/claude.js";
import { invokeCodex } from "./providers/codex.js";
import { invokeOpenCode } from "./providers/opencode.js";
import { invokeClaudeSdk } from "./providers/claudeSdk.js";
import { invokeCodexSdk } from "./providers/codexSdk.js";
/**
 * Dispatch a hosted invocation by `(harness, runtime)`. The two axes are
 * intentionally orthogonal: `harness` is the agent runtime brand
 * (claude/codex/opencode) and `runtime` is the invocation mechanism
 * (cli vs in-process SDK). `opencode:sdk` is rejected at validation time, so
 * it never lands here — we throw if it does to flag the contract violation.
 */
function invokerFor(harness, runtime) {
    switch (`${harness}:${runtime}`) {
        case "claude:cli":
            return { invoke: invokeClaude };
        case "claude:sdk":
            return { invoke: invokeClaudeSdk };
        case "codex:cli":
            return { invoke: invokeCodex };
        case "codex:sdk":
            return { invoke: invokeCodexSdk };
        case "opencode:cli":
            return { invoke: invokeOpenCode };
        case "opencode:sdk":
            throw new Error("opencode:sdk is not supported — pick a CLI-backed opencode profile or another harness");
        default: {
            const exhaustive = `${harness}:${runtime}`;
            throw new Error(`Unknown harness/runtime combination: ${exhaustive}`);
        }
    }
}
export async function invokeHostedCli(request, session) {
    const { harness, runtime } = request.runtime;
    const result = await invokerFor(harness, runtime).invoke({
        prompt: request.prompt,
        runtime: request.runtime,
        session,
    });
    const active = getActiveRun();
    if (active) {
        emitEvent({
            type: "log",
            runId: active.runId,
            message: `llm.invocation harness=${harness} runtime=${runtime} session=${result.session.sessionId && session?.sessionId ? "resumed" : "started"} cachedTokens=${result.cacheStats?.cachedInputTokens ?? 0} totalTokens=${result.cacheStats?.totalInputTokens ?? 0}`,
        });
    }
    return result;
}
function parseJsonObject(text) {
    const trimmed = text.trim();
    const candidates = [];
    candidates.push(trimmed);
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fence?.[1])
        candidates.push(fence[1].trim());
    const outermost = extractOutermostJsonObject(trimmed);
    if (outermost)
        candidates.push(outermost);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            // Try the next candidate.
        }
    }
    throw new Error(`Provider output did not contain a JSON object: ${trimmed.slice(0, 200)}`);
}
function extractOutermostJsonObject(text) {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            ({ escape, inString } = updateStringState(ch, escape, inString));
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "{") {
            if (depth === 0)
                start = i;
            depth++;
        }
        else if (ch === "}") {
            depth--;
            if (depth === 0 && start >= 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null;
}
function updateStringState(ch, escape, inString) {
    if (escape)
        return { escape: false, inString };
    if (ch === "\\")
        return { escape: true, inString };
    if (ch === '"')
        return { escape: false, inString: false };
    return { escape: false, inString };
}
/**
 * Invoke the hosted runtime and parse the response as a JSON envelope. If the
 * first invocation returns non-JSON, re-invoke once with a hardening hint
 * appended to the prompt. Session ids are threaded through both turns so
 * provider-native conversation state keeps working.
 */
async function invokeAndParse(params) {
    const firstResult = await invokeHostedCli(params.request, params.session);
    let session = firstResult.session;
    try {
        return { envelope: params.parse(parseJsonObject(firstResult.outputText)), session };
    }
    catch (err) {
        const retryPrompt = buildRetryPrompt(params.request.prompt, params.retryHint, firstResult.outputText);
        const retryResult = await invokeHostedCli({ ...params.request, prompt: retryPrompt }, session);
        session = retryResult.session;
        try {
            return { envelope: params.parse(parseJsonObject(retryResult.outputText)), session };
        }
        catch {
            throw err;
        }
    }
}
function buildRetryPrompt(prompt, retryHint, previousOutput) {
    return `${prompt}\n\n${retryHint}\n\nPrevious response (for your reference):\n${previousOutput.slice(0, 2000)}`;
}
const STAGE_RETRY_HINT = "IMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now.";
const REVIEW_RETRY_HINT = "IMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the review output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now.";
export class HostedStageAdapter {
    input;
    session;
    constructor(input) {
        this.input = input;
        this.session = { harness: input.harness, sessionId: null };
    }
    getSessionId() {
        return this.session.sessionId;
    }
    setSessionId(sessionId) {
        this.session = { harness: this.input.harness, sessionId };
    }
    async step(request) {
        const runtime = {
            harness: this.input.harness,
            runtime: this.input.runtime,
            provider: this.input.provider,
            model: this.input.model,
            workspaceRoot: this.input.workspaceRoot,
            policy: this.input.runtimePolicy,
        };
        const prompt = buildStagePrompt({
            stageId: this.input.stageId,
            harness: this.input.harness,
            runtime: this.input.runtime,
            model: this.input.model,
            runtimePolicy: this.input.runtimePolicy,
            request,
        });
        const { envelope, session } = await invokeAndParse({
            request: { kind: "stage", runtime, prompt, payload: request },
            session: this.session,
            parse: raw => raw,
            retryHint: STAGE_RETRY_HINT,
        });
        this.session = session;
        return mapStageEnvelopeToResponse(envelope);
    }
}
export class HostedReviewAdapter {
    input;
    session;
    constructor(input) {
        this.input = input;
        this.session = { harness: input.harness, sessionId: null };
    }
    getSessionId() {
        return this.session.sessionId;
    }
    setSessionId(sessionId) {
        this.session = { harness: this.input.harness, sessionId };
    }
    async review(request) {
        if (!request)
            throw new Error("Hosted review adapter requires a review payload");
        const runtime = {
            harness: this.input.harness,
            runtime: this.input.runtime,
            provider: this.input.provider,
            model: this.input.model,
            workspaceRoot: this.input.workspaceRoot,
            policy: this.input.runtimePolicy,
        };
        const prompt = buildReviewPrompt({
            stageId: this.input.stageId,
            harness: this.input.harness,
            runtime: this.input.runtime,
            model: this.input.model,
            runtimePolicy: this.input.runtimePolicy,
            request,
        });
        const { envelope, session } = await invokeAndParse({
            request: { kind: "review", runtime, prompt, payload: request },
            session: this.session,
            parse: raw => raw,
            retryHint: REVIEW_RETRY_HINT,
        });
        this.session = session;
        return mapReviewEnvelopeToResponse(envelope);
    }
}
export { parseJsonObject };
