import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { layout } from "./workspaceLayout.js";
function nowIso() {
    return new Date().toISOString();
}
/** Resolve the single canonical `recovery.json` path for a scope. */
export function recoveryFilePath(ctx, scope) {
    switch (scope.type) {
        case "stage":
            return join(layout.stageDir(ctx, scope.stageId), "recovery.json");
        case "story":
            return join(layout.executionRalphDir(ctx, scope.waveNumber, scope.storyId), "recovery.json");
        case "run":
            return join(layout.runDir(ctx), "recovery.json");
    }
}
/** Projection key stored on `runs.recovery_scope_ref`. */
export function scopeRef(scope) {
    switch (scope.type) {
        case "stage":
            return scope.stageId;
        case "story":
            return `${scope.waveNumber}/${scope.storyId}`;
        case "run":
            return null;
    }
}
export async function writeRecoveryRecord(ctx, record) {
    const path = recoveryFilePath(ctx, record.scope);
    await mkdir(dirname(path), { recursive: true });
    const existing = await readRecoveryRecord(ctx, record.scope);
    const createdAt = existing?.createdAt ?? nowIso();
    const next = { ...record, createdAt, updatedAt: nowIso() };
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
}
export async function readRecoveryRecord(ctx, scope) {
    try {
        const raw = await readFile(recoveryFilePath(ctx, scope), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
