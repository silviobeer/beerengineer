import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { readApiTokenFile } from "../../api/tokenFile.js";
import { readEnginePidFile } from "../../api/pidFile.js";
import { buildUpdateStatus, markPreparedUpdateInFlight, prepareUpdateApply, runUpdateCheck, runUpdateDryRun, } from "../../core/updateMode.js";
import { loadEffectiveConfig, withRepos } from "../common.js";
export async function runUpdateCommand(cmd) {
    const config = loadEffectiveConfig();
    if (!config) {
        console.error("  App config is unavailable. Run beerengineer setup first.");
        return 2;
    }
    return withRepos(async (repos) => {
        const status = buildUpdateStatus(repos, config);
        if (cmd.rollback)
            return handleUnsupportedUpdateRollback(cmd, status);
        if (cmd.dryRun)
            return await handleUpdateDryRunCommand(cmd, repos, config, status);
        if (!cmd.check)
            return await handleUpdateApplyCommand(cmd, repos, config, status);
        return await handleUpdateCheckCommand(cmd, repos, config, status);
    });
}
function handleUnsupportedUpdateRollback(cmd, status) {
    const payload = {
        status,
        error: "post-migration-rollback-unsupported",
        code: "post-migration-rollback-unsupported",
    };
    if (cmd.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    }
    else {
        console.error("  Manual rollback is not supported after migrations have run.");
        console.error("  Restore the pre-update backup manually instead.");
        console.error("  code:             post-migration-rollback-unsupported");
    }
    return 1;
}
async function handleUpdateDryRunCommand(cmd, repos, config, status) {
    try {
        const dryRun = await runUpdateDryRun(repos, config, {
            version: cmd.version,
            allowLegacyDbShadow: cmd.allowLegacyDbShadow,
        });
        const nextStatus = buildUpdateStatus(repos, config, { latestRelease: dryRun.targetRelease });
        if (cmd.json) {
            process.stdout.write(`${JSON.stringify({ status: nextStatus, dryRun }, null, 2)}\n`);
        }
        else {
            console.log(`  dry-run status:   ${dryRun.status}`);
            console.log(`  current version:  ${dryRun.currentVersion}`);
            console.log(`  target release:   ${dryRun.targetRelease.tag}`);
            console.log(`  update repo:      ${dryRun.githubRepo}`);
            console.log(`  install root:     ${nextStatus.install.root}`);
            if (dryRun.warnings.length > 0)
                console.log(`  warnings:         ${dryRun.warnings.join(", ")}`);
            dryRun.stages.forEach(stage => {
                console.log(`  ${stage.name.padEnd(16)} ${stage.status.toUpperCase()}  ${stage.detail}`);
            });
        }
        return dryRun.status === "aborted-dry-run" ? 0 : 1;
    }
    catch (err) {
        if (cmd.json) {
            process.stdout.write(`${JSON.stringify({ status, error: err.message }, null, 2)}\n`);
        }
        else {
            console.error(`  Update dry-run failed: ${err.message}`);
        }
        return 1;
    }
}
async function handleUpdateApplyCommand(cmd, repos, config, status) {
    try {
        const remote = await maybeSubmitRemoteUpdateApply(config, cmd);
        const apply = remote?.apply ?? await prepareUpdateApply(repos, config, {
            version: cmd.version,
            allowLegacyDbShadow: cmd.allowLegacyDbShadow,
        });
        const execution = remote?.execution ?? await maybeStartPreparedUpdateExecution(repos, config, apply.operationId, apply.switcherPath);
        if (cmd.json) {
            process.stdout.write(`${JSON.stringify({ status: buildUpdateStatus(repos, config, { latestRelease: apply.targetRelease }), apply, execution }, null, 2)}\n`);
        }
        else {
            console.log(`  apply state:      ${apply.state}`);
            console.log(`  operation id:     ${apply.operationId}`);
            console.log(`  current version:  ${apply.currentVersion}`);
            console.log(`  target release:   ${apply.targetRelease.tag}`);
            console.log(`  update repo:      ${apply.githubRepo}`);
            console.log(`  staged root:      ${apply.stagedRoot}`);
            console.log(`  switcher script:  ${apply.switcherPath}`);
            if (apply.warnings.length > 0)
                console.log(`  warnings:         ${apply.warnings.join(", ")}`);
            if (execution.started) {
                console.log("  shutdown:         accepted");
                console.log("  executor:         started");
            }
            else {
                console.log(`  executor:         not started (${execution.reason})`);
                console.log("  The release has been staged and recorded, but no live local engine was available for automatic shutdown.");
            }
        }
        return 0;
    }
    catch (err) {
        if (cmd.json) {
            process.stdout.write(`${JSON.stringify({ status, error: err.message }, null, 2)}\n`);
        }
        else {
            console.error(`  Update apply preparation failed: ${err.message}`);
        }
        return 1;
    }
}
async function handleUpdateCheckCommand(cmd, repos, config, status) {
    const operationId = randomUUID();
    try {
        const check = await runUpdateCheck(config, { version: cmd.version });
        repos.upsertUpdateAttempt({
            operationId,
            kind: "check",
            status: "succeeded",
            fromVersion: check.currentVersion,
            targetVersion: check.latestRelease.version,
            dbPath: status.dbPath,
            dbPathSource: status.dbPathSource,
            legacyDbShadow: status.warnings.some(w => w.startsWith("legacy-db-shadow:")),
            installRoot: status.install.root,
            metadataJson: JSON.stringify({ checkedAt: check.checkedAt, githubRepo: check.githubRepo }),
            completedAt: Date.now(),
        });
        if (cmd.json) {
            process.stdout.write(`${JSON.stringify({ status: buildUpdateStatus(repos, config, { latestRelease: check.latestRelease }), check }, null, 2)}\n`);
        }
        else {
            console.log(`  current version: ${check.currentVersion}`);
            console.log(`  latest release:  ${check.latestRelease.tag}`);
            console.log(`  update repo:     ${check.githubRepo}`);
            console.log(`  published:       ${check.latestRelease.publishedAt ?? "unknown"}`);
            console.log(`  available:       ${check.updateAvailable ? "yes" : "no"}`);
            if (status.warnings.length > 0)
                console.log(`  warnings:        ${status.warnings.join(", ")}`);
            console.log(`  db path:         ${status.dbPath} (${status.dbPathSource})`);
            console.log(`  install root:    ${status.install.root}`);
            console.log(`  release url:     ${check.latestRelease.url}`);
        }
        return 0;
    }
    catch (err) {
        repos.upsertUpdateAttempt({
            operationId,
            kind: "check",
            status: "failed",
            fromVersion: status.currentVersion,
            dbPath: status.dbPath,
            dbPathSource: status.dbPathSource,
            legacyDbShadow: status.warnings.some(w => w.startsWith("legacy-db-shadow:")),
            installRoot: status.install.root,
            errorMessage: err.message,
            completedAt: Date.now(),
        });
        if (cmd.json) {
            process.stdout.write(`${JSON.stringify({ status, error: err.message }, null, 2)}\n`);
        }
        else {
            console.error(`  Update check failed: ${err.message}`);
        }
        return 1;
    }
}
async function maybeStartPreparedUpdateExecution(repos, config, operationId, switcherPath) {
    const pid = readEnginePidFile();
    if (pid?.port === config.enginePort)
        return { started: false, reason: "engine_running_use_api_apply" };
    if (!existsSync(join(config.dataDir, "install", "current", "apps", "engine", "bin", "update-backup.js"))) {
        return { started: false, reason: "managed_current_missing" };
    }
    if (!markPreparedUpdateInFlight(repos, operationId)) {
        return { started: false, reason: "update_attempt_not_queued" };
    }
    const child = spawn(switcherPath, [], {
        detached: true,
        stdio: "ignore",
        env: process.env,
    });
    child.unref();
    return { started: true, reason: "local_executor_started" };
}
async function maybeSubmitRemoteUpdateApply(config, cmd) {
    const pid = readEnginePidFile();
    if (pid?.port !== config.enginePort)
        return null;
    if (!existsSync(join(config.dataDir, "install", "current", "apps", "engine", "bin", "update-backup.js")))
        return null;
    const token = process.env.BEERENGINEER_API_TOKEN ?? readApiTokenFile();
    if (!token)
        return null;
    const response = await fetch(`http://127.0.0.1:${config.enginePort}/update/apply`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-beerengineer-token": token,
        },
        body: JSON.stringify({
            version: cmd.version,
            allowLegacyDbShadow: cmd.allowLegacyDbShadow === true,
        }),
    }).catch(() => null);
    if (!response)
        return null;
    if (response.status !== 202) {
        const body = await response.json().catch(() => ({ error: `http_${response.status}` }));
        throw new Error(body.error || `update_apply_failed:http_${response.status}`);
    }
    const apply = await response.json();
    return {
        apply,
        execution: { started: true, reason: "engine_handoff_requested" },
    };
}
