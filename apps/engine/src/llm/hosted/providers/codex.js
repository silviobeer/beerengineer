import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizePreviewValue } from "../../../core/messagePreview.js";
import { invokeProviderCli } from "./_invoke.js";
import { emitHostedThinking, emitHostedTokens, emitHostedToolCalled, emitHostedToolResult, makeJsonLineStreamCallback } from "./_stream.js";
function createCodexStreamState() {
    return { streamedSummary: false, tempDir: null, responsePath: null };
}
function codexTurnCompletedSummary(usage) {
    const parts = [];
    if (usage?.input_tokens !== undefined)
        parts.push(`in=${usage.input_tokens}`);
    if (usage?.output_tokens !== undefined)
        parts.push(`out=${usage.output_tokens}`);
    if (usage?.cached_input_tokens !== undefined)
        parts.push(`cache=${usage.cached_input_tokens}`);
    return parts.length > 0 ? ` (${parts.join(" ")})` : "";
}
function codexItemSummary(event, state, completed) {
    if (!event.item?.type)
        return null;
    if (!completed) {
        if (event.item.type === "reasoning" && typeof event.item.text === "string") {
            emitHostedThinking(sanitizePreviewValue(event.item.text) ?? event.item.text, "codex");
        }
        else {
            emitHostedToolCalled(event.item.name ?? event.item.type, sanitizePreviewValue(event.item.text), "codex");
        }
        state.streamedSummary = true;
        const itemNameSuffix = event.item.name ? ` ${event.item.name}` : "";
        return { kind: "dim", text: `codex: ${event.item.type}${itemNameSuffix}` };
    }
    emitHostedToolResult(event.item.name ?? event.item.type, undefined, sanitizePreviewValue(event.item.text), "codex");
    state.streamedSummary = true;
    return { kind: "dim", text: `codex: ${event.item.type} done` };
}
function summarizeCodexEvent(event, state) {
    switch (event.type) {
        case "thread.started":
            state.streamedSummary = true;
            return { kind: "dim", text: `codex: thread started (${event.thread_id ?? "unknown"})` };
        case "turn.started":
            state.streamedSummary = true;
            return { kind: "dim", text: `codex: turn started` };
        case "turn.completed": {
            state.streamedSummary = true;
            return { kind: "dim", text: `codex: turn completed${codexTurnCompletedSummary(event.usage)}` };
        }
        case "item.started":
        case "item.added":
            return codexItemSummary(event, state, false);
        case "item.completed":
            return codexItemSummary(event, state, true);
        case "error":
            state.streamedSummary = true;
            return { kind: "step", text: `codex error: ${event.message ?? "unknown"}` };
        default:
            return null;
    }
}
/**
 * Operator opt-in: when set to a truthy value, codex's built-in OS sandbox is
 * skipped for `safe-readonly` and `safe-workspace-write` policies. The CLI
 * runs with `--full-auto --dangerously-bypass-approvals-and-sandbox` instead.
 *
 * Why this exists: codex's `--sandbox <mode>` relies on host primitives
 * (Linux landlock + seccomp). On hosts where those primitives are missing or
 * broken — e.g. unprivileged containers, certain distro/kernel combos, or
 * hosts whose seccomp policy strips the syscalls codex needs — every shell
 * call inside the sandbox is silently rejected. The model then reports
 * "execution environment rejected every local command invocation" and
 * cannot inspect the repo or run tests. Setting this env var trades the
 * OS-level sandbox for trust in the host (beerengineer_ already runs codex
 * in the registered worktree the operator owns). `no-tools` policy still
 * pins to `read-only` since it never needs shell access at all.
 *
 * Truthy: `1`, `true`, `yes` (case-insensitive). Anything else is false.
 */
export function codexSandboxBypassEnabled(env = process.env) {
    const raw = env.BEERENGINEER_CODEX_SANDBOX_BYPASS?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
}
export function buildCodexCommand(input, state, tempDir, env = process.env) {
    state.tempDir = tempDir;
    state.responsePath = join(tempDir, "last-message.txt");
    const command = ["codex", "exec"];
    const isResume = !!input.session?.sessionId;
    if (isResume)
        command.push("resume", input.session.sessionId);
    command.push("--skip-git-repo-check", "--json");
    // `codex exec resume` does not accept `--sandbox <mode>` — only `--full-auto`
    // and `--dangerously-bypass-approvals-and-sandbox`. Route the safe-readonly /
    // safe-workspace-write modes through `-c sandbox_mode=<mode>` on resume, which
    // both subcommands accept.
    const bypass = codexSandboxBypassEnabled(env);
    applyCodexSandboxMode(command, input.runtime.policy.mode, { isResume, bypass });
    if (input.runtime.model)
        command.push("--model", input.runtime.model);
    // `codex exec resume` inherits cwd from the original session and rejects
    // `--cd`; only pass it on fresh exec. no-tools also benefits from setting cwd
    // (it still reads stdin → writes JSON, no shell calls), so keep the default.
    if (!isResume)
        command.push("--cd", input.runtime.workspaceRoot);
    command.push("--output-last-message", state.responsePath, "-");
    return command;
}
function applyCodexSandboxMode(command, mode, options) {
    const { isResume, bypass } = options;
    if (mode === "no-tools") {
        // Stage agents + reviewers: emit JSON only, no shell. Pin the sandbox to
        // the strictest mode codex offers so a misbehaving model cannot touch the
        // filesystem either way. The bypass env var deliberately does not weaken
        // this — no-tools never needs shell access.
        pushCodexSandboxCommand(command, isResume, "read-only");
        return;
    }
    if (bypass || mode === "unsafe-autonomous-write") {
        // codex enforces mutual exclusion between --full-auto and
        // --dangerously-bypass-approvals-and-sandbox. The bypass flag alone
        // already implies --full-auto's behaviour (skip approvals, no sandbox).
        command.push("--dangerously-bypass-approvals-and-sandbox");
        return;
    }
    pushCodexSandboxCommand(command, isResume, mode === "safe-workspace-write" ? "workspace-write" : "read-only");
}
function pushCodexSandboxCommand(command, isResume, mode) {
    if (isResume) {
        pushCodexResumeSandboxCommand(command, mode);
        return;
    }
    pushCodexFreshSandboxCommand(command, mode);
}
function pushCodexResumeSandboxCommand(command, mode) {
    command.push("-c", `sandbox_mode="${mode}"`);
}
function pushCodexFreshSandboxCommand(command, mode) {
    command.push("--sandbox", mode);
}
function parseUsage(stdout) {
    let sessionId = null;
    let cachedInputTokens = 0;
    let totalInputTokens = 0;
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        try {
            const event = JSON.parse(line);
            if (event.type === "thread.started" && typeof event.thread_id === "string")
                sessionId = event.thread_id;
            if (event.type === "turn.completed") {
                cachedInputTokens = event.usage?.cached_input_tokens ?? 0;
                totalInputTokens = event.usage?.input_tokens ?? 0;
            }
        }
        catch {
            // Ignore non-JSON noise.
        }
    }
    return { sessionId, cachedInputTokens, totalInputTokens };
}
/**
 * Codex needs a fresh temp dir per-attempt because `--output-last-message`
 * writes to a file path. We pre-allocate it before the driver builds the
 * command and clean it up in `afterEach`.
 */
export async function invokeCodex(input) {
    const tempDir = await mkdtemp(join(tmpdir(), "beerengineer-codex-"));
    const driver = {
        tag: "codex",
        createStreamState: createCodexStreamState,
        buildCommand: activeInput => buildCodexCommand(activeInput, state, tempDir),
        streamCallback: ownState => makeJsonLineStreamCallback({
            summarize: event => summarizeCodexEvent(event, ownState),
        }),
        streamedSummary: ownState => ownState.streamedSummary,
        unknownSession: text => /unknown thread|expired thread|resume.*not found|invalid thread/i.test(text),
        async finalize({ input: activeInput, raw, command, state: finalState }) {
            const outputText = (finalState.responsePath
                ? await readFile(finalState.responsePath, "utf8").catch(() => "")
                : "") || raw.stdout;
            const usage = parseUsage(raw.stdout);
            emitHostedTokens(usage.totalInputTokens, 0, usage.cachedInputTokens, "codex", activeInput.runtime.model);
            return {
                ...raw,
                command,
                outputText,
                session: { harness: activeInput.runtime.harness, sessionId: usage.sessionId ?? activeInput.session?.sessionId ?? null },
                cacheStats: {
                    cachedInputTokens: usage.cachedInputTokens,
                    totalInputTokens: usage.totalInputTokens,
                },
            };
        },
    };
    // `state` is the driver's mutable state. We need a reference accessible
    // from `buildCommand` (called before `createStreamState` returns into the
    // driver) — so we pre-create it and use a closure.
    const state = driver.createStreamState();
    // Override createStreamState to hand back the same pre-allocated state.
    driver.createStreamState = () => state;
    try {
        return await invokeProviderCli(driver, input);
    }
    finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}
