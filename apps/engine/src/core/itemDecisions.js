import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { layout } from "./workspaceLayout.js";
function decisionsPath(ctx) {
    return join(layout.workspaceDir(ctx), "decisions.json");
}
function readFile(ctx) {
    const path = decisionsPath(ctx);
    if (!existsSync(path))
        return null;
    try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        if (raw.schemaVersion !== 1 || !Array.isArray(raw.decisions))
            return null;
        return { schemaVersion: 1, decisions: raw.decisions };
    }
    catch {
        return null;
    }
}
function writeFileSafe(ctx, content) {
    const path = decisionsPath(ctx);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(content, null, 2), "utf8");
}
export function loadItemDecisions(ctx) {
    if (!ctx?.workspaceId || !ctx.workspaceRoot)
        return [];
    return readFile(ctx)?.decisions ?? [];
}
// Decisions are append-only; the same prompt id is treated as an update
// (operator changed their mind) so we keep the most recent answer.
export function appendItemDecision(ctx, decision) {
    const current = readFile(ctx) ?? { schemaVersion: 1, decisions: [] };
    const filtered = current.decisions.filter(d => d.id !== decision.id);
    filtered.push(decision);
    writeFileSafe(ctx, { schemaVersion: 1, decisions: filtered });
}
