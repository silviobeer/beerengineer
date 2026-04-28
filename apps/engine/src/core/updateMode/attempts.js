import { currentAppVersion } from "./shared.js";
export function replayPreparedUpdateApply(row) {
    if (row.kind !== "apply" || (row.status !== "queued" && row.status !== "in-flight"))
        return null;
    const metadata = parseMetadataJson(row);
    const targetRelease = metadata.targetRelease;
    const warnings = metadata.warnings;
    if (typeof metadata.githubRepo !== "string" ||
        typeof metadata.stagedRoot !== "string" ||
        typeof metadata.switcherPath !== "string" ||
        typeof metadata.metadataPath !== "string" ||
        !targetRelease ||
        typeof targetRelease !== "object") {
        return null;
    }
    const release = targetRelease;
    if (typeof release.tag !== "string" ||
        typeof release.version !== "string" ||
        typeof release.tarballUrl !== "string" ||
        typeof release.url !== "string") {
        return null;
    }
    return {
        operationId: row.operation_id,
        state: row.status,
        currentVersion: row.from_version ?? currentAppVersion(),
        targetRelease: {
            tag: release.tag,
            version: release.version,
            publishedAt: typeof release.publishedAt === "string" ? release.publishedAt : null,
            tarballUrl: release.tarballUrl,
            url: release.url,
        },
        githubRepo: metadata.githubRepo,
        stagedRoot: metadata.stagedRoot,
        switcherPath: metadata.switcherPath,
        metadataPath: metadata.metadataPath,
        warnings: Array.isArray(warnings) ? warnings.filter((entry) => typeof entry === "string") : [],
    };
}
export function latestAttemptPayload(row) {
    if (!row)
        return null;
    return {
        operationId: row.operation_id,
        kind: row.kind,
        status: row.status,
        fromVersion: row.from_version,
        targetVersion: row.target_version,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        errorMessage: row.error_message,
    };
}
export function markPreparedUpdateInFlight(repos, operationId) {
    const existing = repos.getUpdateAttempt(operationId);
    if (existing?.status !== "queued")
        return null;
    const row = repos.upsertUpdateAttempt({
        operationId,
        kind: existing.kind,
        status: "in-flight",
        fromVersion: existing.from_version,
        targetVersion: existing.target_version,
        dbPath: existing.db_path,
        dbPathSource: existing.db_path_source,
        legacyDbShadow: existing.legacy_db_shadow === 1,
        installRoot: existing.install_root,
        backupDir: existing.backup_dir,
        errorMessage: existing.error_message,
        metadataJson: existing.metadata_json,
    });
    return historyPayload(row);
}
export function listUpdateHistory(repos, limit = 20) {
    return repos.listUpdateAttempts(limit).map(historyPayload);
}
export function legacyShadowWarning(status) {
    return status.warnings.find(w => w.startsWith("legacy-db-shadow:")) ?? null;
}
function historyPayload(row) {
    return {
        operationId: row.operation_id,
        kind: row.kind,
        status: row.status,
        fromVersion: row.from_version,
        targetVersion: row.target_version,
        dbPath: row.db_path,
        dbPathSource: row.db_path_source,
        legacyDbShadow: row.legacy_db_shadow === 1,
        installRoot: row.install_root,
        backupDir: row.backup_dir,
        errorMessage: row.error_message,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    };
}
function parseMetadataJson(row) {
    if (!row.metadata_json)
        return {};
    try {
        return JSON.parse(row.metadata_json);
    }
    catch {
        return {};
    }
}
