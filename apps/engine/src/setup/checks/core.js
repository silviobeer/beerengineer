import Database from "better-sqlite3";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { initDatabase } from "../../db/connection.js";
import { Repos } from "../../db/repositories.js";
import { resolveWorkflowContextForRun } from "../../core/workflowContextResolver.js";
import { layout } from "../../core/workspaceLayout.js";
import { createFrontendDesignReview, createFrontendDesignStage, createVisualCompanionReview, createVisualCompanionStage, } from "../../llm/registry.js";
import { REQUIRED_MIGRATION_LEVEL, resolveConfiguredDbPath } from "../config.js";
import { createCheck, probeCommand } from "./shared.js";
export async function runCoreChecks(configPath, configState, config) {
    const checks = [];
    const major = currentNodeMajorVersion();
    checks.push(createCheck("core.node", "Node.js runtime", major >= 22 ? "ok" : "misconfigured", `v${process.versions.node}${major >= 22 ? "" : " (>= 22 required)"}`));
    const git = await probeCommand("git", ["--version"]);
    checks.push(createCheck("core.git", "git on PATH", git.ok ? "ok" : "missing", git.version ?? git.detail, { remedy: git.ok ? undefined : { hint: "Install Git and ensure it is on PATH.", url: "https://git-scm.com/downloads" } }));
    const preconditionChecks = buildCorePreconditionChecks(configPath, configState, config);
    if (preconditionChecks)
        return [...checks, ...preconditionChecks];
    const resolvedConfig = config;
    checks.push(createCheck("core.config", "config file", "ok", configPath), checkConfiguredDataDir(resolvedConfig.dataDir));
    const dbPath = resolveConfiguredDbPath(resolvedConfig);
    if (!existsSync(dbPath)) {
        return [
            ...checks,
            createCheck("core.db", "configured database", "missing", dbPath),
            createCheck("core.migrations", "database migration level", "skipped", "database file is missing"),
        ];
    }
    return [
        ...checks,
        ...readableDatabaseChecks(dbPath),
        checkDesignPrepAdapters(),
        await checkDesignPrepReferences(dbPath),
    ];
}
function checkConfiguredDataDir(dataDir) {
    if (!existsSync(dataDir))
        return createCheck("core.dataDir", "configured data dir", "missing", dataDir);
    try {
        accessSync(dataDir, constants.W_OK);
        return createCheck("core.dataDir", "configured data dir", "ok", dataDir);
    }
    catch (err) {
        return createCheck("core.dataDir", "configured data dir", "misconfigured", `${dataDir}: ${err.message}`);
    }
}
function readableDatabaseChecks(dbPath) {
    try {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        db.prepare("SELECT 1").get();
        const userVersion = db.pragma("user_version", { simple: true }) ?? 0;
        db.close();
        return [
            createCheck("core.db", "configured database", "ok", dbPath),
            createCheck("core.migrations", "database migration level", userVersion === REQUIRED_MIGRATION_LEVEL ? "ok" : "misconfigured", `current=${userVersion}, required=${REQUIRED_MIGRATION_LEVEL}`),
        ];
    }
    catch (err) {
        return [
            createCheck("core.db", "configured database", "misconfigured", `${dbPath}: ${err.message}`),
            createCheck("core.migrations", "database migration level", "skipped", "database is not readable"),
        ];
    }
}
function checkDesignPrepAdapters() {
    try {
        createVisualCompanionStage();
        createVisualCompanionReview();
        createFrontendDesignStage();
        createFrontendDesignReview();
        return createCheck("core.designPrepAdapters", "design-prep adapters registered", "ok", "visual-companion + frontend-design");
    }
    catch (err) {
        return createCheck("core.designPrepAdapters", "design-prep adapters registered", "misconfigured", err.message);
    }
}
async function checkDesignPrepReferences(dbPath) {
    try {
        const db = initDatabase(dbPath);
        const repos = new Repos(db);
        const hasUiRun = repoHasUiRun(repos);
        const workspace = repos.listWorkspaces().find(candidate => candidate.root_path);
        db.close();
        if (!hasUiRun) {
            return createCheck("core.designPrepReferences", "design-prep references folder writable", "skipped", "no UI-bearing runs detected");
        }
        if (!workspace?.root_path) {
            return createCheck("core.designPrepReferences", "design-prep references folder writable", "skipped", "no registered workspace roots");
        }
        return probeDesignPrepReferences(workspace.root_path);
    }
    catch (err) {
        return createCheck("core.designPrepReferences", "design-prep references folder writable", "misconfigured", err.message);
    }
}
function repoHasUiRun(repos) {
    return repos.listRuns().filter(run => run.workspace_fs_id).some(run => {
        try {
            const ctx = resolveWorkflowContextForRun(repos, run);
            if (!ctx)
                return false;
            const projectsPath = layout.stageArtifactsDir(ctx, "brainstorm");
            const projects = JSON.parse(readFileSync(`${projectsPath}/projects.json`, "utf8"));
            return projects.some(project => project.hasUi === true);
        }
        catch {
            return false;
        }
    });
}
function probeDesignPrepReferences(workspaceRoot) {
    const probeTarget = `${workspaceRoot}/.beerengineer`;
    const parentTarget = existsSync(probeTarget) ? probeTarget : workspaceRoot;
    accessSync(parentTarget, constants.W_OK);
    return createCheck("core.designPrepReferences", "design-prep references folder writable", "ok", `${probeTarget}/references/design-prep (parent: ${parentTarget})`);
}
function currentNodeMajorVersion() {
    const [major] = process.versions.node.split(".").map(Number);
    return major;
}
function buildCorePreconditionChecks(configPath, configState, config) {
    if (configState.kind === "missing") {
        return [
            createCheck("core.config", "config file", "uninitialized", `missing at ${configPath}`),
            createCheck("core.dataDir", "configured data dir", "uninitialized", "config has not been initialized"),
            createCheck("core.db", "configured database", "uninitialized", "config has not been initialized"),
            createCheck("core.migrations", "database migration level", "uninitialized", "config has not been initialized"),
        ];
    }
    if (configState.kind === "invalid") {
        return [
            createCheck("core.config", "config file", "misconfigured", `${configPath}: ${configState.error}`),
            createCheck("core.dataDir", "configured data dir", "skipped", "config is invalid"),
            createCheck("core.db", "configured database", "skipped", "config is invalid"),
            createCheck("core.migrations", "database migration level", "skipped", "config is invalid"),
        ];
    }
    if (config)
        return null;
    return [
        createCheck("core.config", "config file", "unknown", `${configPath}: effective config could not be resolved`),
        createCheck("core.dataDir", "configured data dir", "skipped", "effective config is unavailable"),
        createCheck("core.db", "configured database", "skipped", "effective config is unavailable"),
        createCheck("core.migrations", "database migration level", "skipped", "effective config is unavailable"),
    ];
}
