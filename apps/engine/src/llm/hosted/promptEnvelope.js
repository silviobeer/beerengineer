import { loadComposedPrompt, loadPrompt, PromptLoadError } from "../prompts/loader.js";
/**
 * Table of per-kind instruction blocks. Every hosted prompt follows the same
 * shape — loadPrompt + instructions + trailing payload — so the three
 * kind-specific builders collapse to thin wrappers over this table.
 */
const SCHEMAS = {
    stage: {
        promptKind: "system",
        allowDefaultFallback: false,
        instructions: [
            "Return exactly one JSON object and nothing else.",
            'Use this exact top-level shape: { "kind": "artifact", "artifact": unknown } OR { "kind": "message", "message": string }',
            'When you need information from the user, emit { "kind": "message", "message": "<your question>" } — the user will respond on the next turn.',
            "Do not use markdown fences.",
            "If this is not your first turn, prior turns may already exist in your native provider session.",
            "The payload's stageContext is the authoritative source for turn counters and review-feedback history.",
            "Do not repeat questions you already asked unless the new payload makes the previous answer insufficient.",
        ],
    },
    review: {
        promptKind: "reviewers",
        allowDefaultFallback: true,
        instructions: [
            "Reviewer runs are read-only.",
            "If this is not your first review cycle, prior reviewer turns may already exist in your native provider session.",
            "The payload's reviewContext is the authoritative source for cycle count, final-cycle semantics, and prior feedback history.",
            "Return exactly one JSON object and nothing else.",
            'Use one of these exact shapes: { "kind": "pass" } | { "kind": "revise", "feedback": string } | { "kind": "block", "reason": string }',
            "Do not use markdown fences.",
        ],
    },
    execution: {
        promptKind: "workers",
        allowDefaultFallback: false,
        instructions: [
            "Modify files directly inside the workspace when required by the task.",
            "If this is not your first implementation iteration, prior turns may already exist in your native provider session.",
            "The payload's iterationContext is the authoritative source for iteration counters and prior failed attempts.",
            "Return exactly one JSON object and nothing else.",
            'Use this exact shape: { "summary": string, "testsRun": Array<{ "command": string, "status": "passed"|"failed"|"not_run" }>, "implementationNotes": string[], "blockers": string[] }',
            "Do not wrap the response in markdown fences.",
        ],
    },
};
const PROMPT_BUNDLES = {
    system: {
        "frontend-design": [
            "design/anti-patterns",
            "design/color-and-contrast",
            "design/interaction-design",
            "design/motion-design",
            "design/responsive-design",
            "design/spatial-design",
            "design/typography",
            "design/ux-writing",
        ],
        qa: [
            "design/anti-patterns",
        ],
    },
    reviewers: {
        "frontend-design": ["design/anti-patterns"],
    },
    workers: {
        execution: [
            "design/anti-patterns",
            "design/color-and-contrast",
            "design/interaction-design",
            "design/spatial-design",
            "design/typography",
        ],
    },
};
function bundlesFor(kind, promptId) {
    return PROMPT_BUNDLES[kind]?.[promptId] ?? [];
}
function loadPromptWithFallback(schema, promptId) {
    const bundleIds = bundlesFor(schema.promptKind, promptId);
    try {
        return bundleIds.length === 0 ? loadPrompt(schema.promptKind, promptId) : loadComposedPrompt(schema.promptKind, promptId, bundleIds);
    }
    catch (error) {
        if (!schema.allowDefaultFallback ||
            !(error instanceof PromptLoadError) ||
            !error.missing ||
            error.source !== "prompt" ||
            error.kind !== schema.promptKind ||
            error.id !== promptId) {
            throw error;
        }
        return loadPrompt(schema.promptKind, "_default");
    }
}
function withPayload(payload, context) {
    return { ...payload, ...context };
}
/**
 * Assemble a hosted prompt. `promptId` is the per-stage system/reviewer file
 * name (or a fixed id for worker prompts like "execution"). `action` appears
 * as its own line so stage-specific phrasing ("Revise the stage output
 * using the supplied review feedback.") remains visible.
 *
 * The prompt body is identical across CLI and SDK runtimes — only the
 * invocation mechanism differs. The `Provider` line still names the harness
 * brand because the prompt files reference "claude" / "codex" by name.
 */
export function buildHostedPrompt(params) {
    const schema = SCHEMAS[params.kind];
    const lines = [loadPromptWithFallback(schema, params.promptId), ...schema.instructions];
    if (params.action)
        lines.push(params.action);
    if (params.identityLines)
        lines.push(...params.identityLines);
    lines.push(`Provider: ${params.harness}`, `Runtime: ${params.runtime}`, `Model: ${params.model ?? "default"}`, `Runtime policy: ${JSON.stringify(params.runtimePolicy)}`, `Payload:\n${JSON.stringify(params.payload, null, 2)}`);
    return lines.join("\n\n");
}
export function buildStagePrompt(input) {
    let action = "Revise the stage output using the supplied review feedback.";
    if (input.request.kind === "begin")
        action = "Start the stage from the provided state.";
    else if (input.request.kind === "user-message")
        action = "Respond to the user and continue the stage.";
    const stageContext = input.request.stageContext ?? null;
    return buildHostedPrompt({
        kind: "stage",
        promptId: input.stageId,
        harness: input.harness,
        runtime: input.runtime,
        model: input.model,
        runtimePolicy: input.runtimePolicy,
        action,
        identityLines: [`Stage: ${input.stageId}`],
        payload: withPayload(input.request, { stageContext }),
    });
}
export function buildReviewPrompt(input) {
    return buildHostedPrompt({
        kind: "review",
        promptId: input.stageId,
        harness: input.harness,
        runtime: input.runtime,
        model: input.model,
        runtimePolicy: input.runtimePolicy,
        identityLines: [`Stage: ${input.stageId}`],
        payload: withPayload(input.request, { reviewContext: input.request.reviewContext ?? null }),
    });
}
export function buildExecutionPrompt(input) {
    return buildHostedPrompt({
        kind: "execution",
        promptId: "execution",
        harness: input.harness,
        runtime: input.runtime,
        model: input.model,
        runtimePolicy: input.runtimePolicy,
        identityLines: [`Story: ${input.storyId}`, `Action: ${input.action}`],
        payload: withPayload(input.payload, {
            iterationContext: input.iterationContext ?? null,
        }),
    });
}
