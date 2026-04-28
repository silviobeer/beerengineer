import { readFile, stat } from "node:fs/promises";
import { extname, resolve as resolvePath, sep } from "node:path";
import { getBoard, getRunTree } from "../board.js";
import { isResumeInFlight } from "../../core/resume.js";
import { buildConversation, recordAnswer, recordUserMessage } from "../../core/conversation.js";
import { MESSAGES_ENDPOINT_MAX_SCAN } from "../../core/constants.js";
import { messagingLevelFromQuery, shouldDeliverAtLevel } from "../../core/messagingLevel.js";
import { projectStageLogRow } from "../../core/messagingProjection.js";
import { resumeRunInProcess, startRunFromIdea } from "../../core/runService.js";
import { json, readJson } from "../http.js";
import { layout } from "../../core/workspaceLayout.js";
import { resolveWorkflowContextForRun } from "../../core/workflowContextResolver.js";
function contentTypeFor(path) {
    switch (extname(path).toLowerCase()) {
        case ".html":
            return "text/html; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".md":
            return "text/markdown; charset=utf-8";
        default:
            return "text/plain; charset=utf-8";
    }
}
export function handleGetBoard(db, url, res) {
    const workspaceKey = url.searchParams.get("workspace");
    const board = getBoard(db, workspaceKey);
    json(res, 200, board);
}
export function handleGetRun(repos, res, runId) {
    const run = repos.getRun(runId);
    if (!run)
        return json(res, 404, { error: "run not found", code: "not_found" });
    const conv = buildConversation(repos, runId);
    json(res, 200, { ...run, openPrompt: conv?.openPrompt ?? null });
}
export function handleGetRunTree(repos, res, runId) {
    const tree = getRunTree(repos, runId);
    if (!tree)
        return json(res, 404, { error: "run not found", code: "not_found" });
    json(res, 200, tree);
}
export function handleGetArtifacts(repos, res, runId) {
    const run = repos.getRun(runId);
    if (!run)
        return json(res, 404, { error: "run not found", code: "not_found" });
    json(res, 200, { runId, artifacts: repos.listArtifactsForRun(runId) });
}
export async function handleGetArtifactFile(repos, res, runId, requestedPath) {
    // Design-prep user-revise iterations derive the on-disk run directory as
    // `<baseRunId>-rev<N>` while the DB still only stores `<baseRunId>`. Accept
    // the revise-suffixed form by looking up the base run row but keeping the
    // derived runId for the disk path.
    const revMatch = /^(.+)-rev(\d+)$/.exec(runId);
    const lookupId = revMatch ? revMatch[1] : runId;
    const run = repos.getRun(lookupId);
    if (!run)
        return json(res, 404, { error: "run not found", code: "not_found" });
    // Decode once — the regex in the router yields the raw URL segment, which
    // may still contain percent-escapes (e.g. %2e for "." inside a segment).
    let decoded;
    try {
        decoded = decodeURIComponent(requestedPath);
    }
    catch {
        return json(res, 400, { error: "invalid_path", code: "bad_request" });
    }
    if (decoded.includes("\0"))
        return json(res, 400, { error: "invalid_path", code: "bad_request" });
    const ctx = resolveWorkflowContextForRun(repos, run, { runIdOverride: runId });
    if (!ctx)
        return json(res, 404, { error: "artifact root unreachable", code: "not_found" });
    const base = resolvePath(layout.runDir(ctx));
    const full = resolvePath(base, decoded);
    if (full !== base && !full.startsWith(base + sep)) {
        return json(res, 400, { error: "invalid_path", code: "bad_request" });
    }
    try {
        const info = await stat(full);
        if (!info.isFile())
            return json(res, 404, { error: "artifact not found", code: "not_found" });
    }
    catch {
        return json(res, 404, { error: "artifact not found", code: "not_found" });
    }
    const body = await readFile(full);
    // Artifact files are written by the engine but rendered from LLM output. Prevent
    // MIME sniffing and disable script execution if the browser ever loads them.
    res.writeHead(200, {
        "content-type": contentTypeFor(full),
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:;",
    });
    res.end(body);
}
export function handleListRuns(repos, res) {
    json(res, 200, { runs: repos.listRuns() });
}
export function handleGetConversation(repos, res, runId) {
    const conversation = buildConversation(repos, runId);
    if (!conversation)
        return json(res, 404, { error: "run not found", code: "not_found" });
    json(res, 200, conversation);
}
export function handleGetMessages(repos, url, res, runId) {
    const run = repos.getRun(runId);
    if (!run)
        return json(res, 404, { error: "run not found", code: "not_found" });
    const level = messagingLevelFromQuery(url.searchParams.get("level"), 2);
    const since = url.searchParams.get("since");
    const rawLimit = Number(url.searchParams.get("limit") ?? 200);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 200;
    const { entries, nextSince } = collectRunMessages(repos, runId, { since, level, limit });
    json(res, 200, {
        runId,
        schema: "messages-v1",
        nextSince,
        entries,
    });
}
function collectRunMessages(repos, runId, options) {
    const entries = [];
    let cursor = options.since;
    let scanned = 0;
    let hitScanCap = false;
    outer: while (entries.length < options.limit) {
        const batch = repos.listLogsForRunAfterId(runId, cursor, options.limit * 4);
        if (batch.length === 0)
            break;
        for (const row of batch) {
            pushVisibleEntry(entries, row, options.level);
            cursor = row.id;
            scanned += 1;
            if (entries.length >= options.limit || scanned >= MESSAGES_ENDPOINT_MAX_SCAN) {
                hitScanCap = true;
                break outer;
            }
        }
        if (batch.length < options.limit * 4)
            break;
    }
    if (entries.length >= options.limit)
        return { entries, nextSince: entries.at(-1)?.id ?? null };
    return { entries, nextSince: hitScanCap ? cursor : null };
}
function pushVisibleEntry(entries, row, level) {
    const entry = projectStageLogRow(row);
    if (entry && shouldDeliverAtLevel(entry, level))
        entries.push(entry);
}
export async function handlePostMessage(repos, req, res, runId) {
    const body = (await readJson(req));
    // External callers can't spoof source — the HTTP boundary pins it to "api".
    // Internal surfaces (CLI, webhook handler) call `recordUserMessage` directly
    // and set their own source.
    const result = recordUserMessage(repos, {
        runId,
        text: typeof body.text === "string" ? body.text : "",
        source: "api",
    });
    if (!result.ok) {
        if (result.code === "empty_message")
            return json(res, 400, { error: "text is required", code: "bad_request" });
        return json(res, 404, { error: "run not found", code: "not_found" });
    }
    const entry = result.conversation.entries.find(candidate => candidate.id === result.entryId) ?? null;
    json(res, 201, { ok: true, entry, conversation: result.conversation });
}
export function handleGetRecovery(repos, res, runId) {
    const run = repos.getRun(runId);
    if (!run)
        return json(res, 404, { error: "run_not_found", code: "not_found" });
    if (!run.recovery_status)
        return json(res, 200, { recovery: null });
    json(res, 200, {
        recovery: {
            status: run.recovery_status,
            scope: run.recovery_scope,
            scopeRef: run.recovery_scope_ref,
            summary: run.recovery_summary,
            resumable: !isResumeInFlight(runId),
            remediations: repos.listExternalRemediations(runId),
        },
    });
}
/**
 * Resume a blocked run. Previously this route recorded the remediation row
 * and returned `needsSpawn: true`; the UI then had to spawn the CLI to
 * re-enter the workflow. Post-refactor the engine HTTP process owns the
 * resume — `resumeRunInProcess` fires the workflow in the background and
 * returns the ids immediately.
 */
export async function handleResumeRun(repos, req, res, runId, onItemColumnChanged) {
    const body = (await readJson(req));
    const result = await resumeRunInProcess(repos, {
        runId,
        summary: body.summary ?? "",
        branch: body.branch,
        commit: body.commit,
        reviewNotes: body.reviewNotes,
        onItemColumnChanged,
    });
    if (!result.ok) {
        return json(res, result.status, { error: result.error });
    }
    const run = repos.getRun(result.runId);
    json(res, 200, { runId: result.runId, status: run?.status ?? "running" });
}
/** `POST /runs` — start a fresh run from a title/description + optional workspace. */
export async function handleCreateRun(repos, req, res, onItemColumnChanged) {
    const body = (await readJson(req));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title)
        return json(res, 400, { error: "title is required", code: "bad_request" });
    const result = startRunFromIdea(repos, {
        title,
        description: typeof body.description === "string" ? body.description.trim() : "",
        workspaceKey: typeof body.workspaceKey === "string" && body.workspaceKey.trim()
            ? body.workspaceKey.trim()
            : undefined,
        onItemColumnChanged,
    });
    if (!result.ok)
        return json(res, result.status, { error: result.error });
    const run = repos.getRun(result.runId);
    json(res, 202, {
        runId: result.runId,
        itemId: result.itemId,
        status: run?.status ?? "running",
    });
}
/**
 * Canonical answer endpoint. Write path:
 *   1. Mark `pending_prompts` row as answered.
 *   2. Append `prompt_answered` to `stage_logs` — `attachCrossProcessBridge`
 *      on the workflow's bus picks it up and re-emits locally, resolving
 *      the workflow's pending `bus.request()`.
 *   3. Return the updated conversation snapshot.
 */
export async function handleAnswer(repos, req, res, runId) {
    const body = (await readJson(req));
    const result = recordAnswer(repos, {
        runId,
        promptId: body.promptId,
        answer: typeof body.answer === "string" ? body.answer : "",
        source: "api",
    });
    if (!result.ok) {
        if (result.code === "empty_answer")
            return json(res, 400, { error: "answer is required", code: "bad_request" });
        if (result.code === "run_not_found")
            return json(res, 404, { error: "run not found", code: "not_found" });
        return json(res, 409, { error: "prompt_not_open", code: "prompt_not_open" });
    }
    json(res, 200, result.conversation);
}
