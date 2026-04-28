import { backfillWorkspaceConfigs, getRegisteredWorkspace, listRegisteredWorkspaces, openWorkspace, previewWorkspace, registerWorkspace, removeWorkspace, } from "../../core/workspaces.js";
import { generateSetupReport } from "../../setup/doctor.js";
import { validateHarnessProfileShape } from "../../setup/config.js";
import { json, readJson } from "../http.js";
function parseWorkspaceProfile(input, config) {
    if (!input)
        return config.llm.defaultHarnessProfile;
    return validateHarnessProfileShape(input);
}
/**
 * generateSetupReport({ allLlmGroups: true }) shells out to probe each LLM
 * CLI (version + auth) on every call. registerWorkspace needs that report
 * to validate harness availability, but running every POST /workspaces
 * through those child processes makes the API needlessly slow. 30 s is
 * short enough that a user who just installed a missing CLI can retry
 * without restarting.
 */
const SETUP_REPORT_TTL_MS = 30_000;
let cachedSetupReport = null;
async function getCachedSetupReport() {
    if (cachedSetupReport && Date.now() - cachedSetupReport.at < SETUP_REPORT_TTL_MS) {
        return cachedSetupReport.report;
    }
    const report = await generateSetupReport({ allLlmGroups: true });
    cachedSetupReport = { report, at: Date.now() };
    return report;
}
export async function handleWorkspacePreview(repos, loadConfig, url, res) {
    const config = loadConfig();
    if (!config)
        return json(res, 409, { error: "config_unavailable" });
    const path = url.searchParams.get("path");
    if (!path)
        return json(res, 400, { error: "path_required" });
    const preview = await previewWorkspace(path, config, repos);
    json(res, 200, preview);
}
export async function handleWorkspaceAdd(repos, loadConfig, req, res) {
    const config = loadConfig();
    if (!config)
        return json(res, 409, { error: "config_unavailable" });
    const body = (await readJson(req));
    if (!body.path)
        return json(res, 400, { error: "path_required" });
    let harnessProfile;
    try {
        harnessProfile = parseWorkspaceProfile(body.harnessProfile, config);
    }
    catch (err) {
        return json(res, 400, { error: "invalid_harness_profile", detail: err.message });
    }
    const input = {
        path: body.path,
        create: body.create,
        name: body.name,
        key: body.key,
        harnessProfile,
        sonar: body.sonar,
        git: body.git,
    };
    const appReport = await getCachedSetupReport();
    const result = await registerWorkspace(input, { repos, config, appReport });
    if (!result.ok)
        return json(res, 409, result);
    json(res, 200, result);
}
export function handleWorkspaceList(repos, res) {
    json(res, 200, { workspaces: listRegisteredWorkspaces(repos) });
}
export function handleWorkspaceGet(repos, res, key) {
    const workspace = getRegisteredWorkspace(repos, key);
    if (!workspace)
        return json(res, 404, { error: "workspace_not_found" });
    json(res, 200, workspace);
}
export async function handleWorkspaceRemove(repos, loadConfig, url, res, key) {
    const purge = url.searchParams.get("purge") === "1" || url.searchParams.get("purge") === "true";
    const config = purge ? loadConfig() : null;
    if (purge && !config)
        return json(res, 409, { error: "config_unavailable" });
    const result = await removeWorkspace(repos, key, {
        purge,
        allowedRoots: config?.allowedRoots,
    });
    if (!result.ok)
        return json(res, 404, { error: "workspace_not_found" });
    json(res, 200, result);
}
export function handleWorkspaceOpen(repos, res, key) {
    const rootPath = openWorkspace(repos, key);
    if (!rootPath)
        return json(res, 404, { error: "workspace_not_found" });
    json(res, 200, { key, rootPath });
}
export async function handleWorkspaceBackfill(repos, res) {
    const result = await backfillWorkspaceConfigs(repos);
    json(res, 200, result);
}
