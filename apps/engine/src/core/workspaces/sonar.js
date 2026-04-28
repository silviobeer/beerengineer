import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SONAR_DEFAULT_HOST, SONAR_PROPERTIES_FILE, splitCsv, expandWorkspacePattern, pathExists, parseSonarProperties, readJsonIfPresent, listWorkspacePackageFiles, packageLooksLikeCoverageProducer, runCommand, runGit, parseGitHubRemote, resolveGitDefaultBranch, detectSonarToken, sonarPropertiesPath, } from "./shared.js";
import { buildPathPreview } from "./shared.js";
import { readWorkspaceConfig } from "./configFile.js";
const SONAR_GENERATOR_ROOTS = ["apps", "packages", "services", "libs", "src", "lib"];
const SONAR_DEFAULT_TEST_INCLUSIONS = "**/*.test.ts,**/*.spec.ts,**/*.test.tsx,**/*.spec.tsx";
const SONAR_DEFAULT_EXCLUSIONS = "**/node_modules/**,**/dist/**,**/.next/**";
const SONAR_DEFAULT_LCOV_PATH = "coverage/**/lcov.info";
async function detectCoverageProducer(root) {
    const rootPkgPath = new URL(`file://${root}/package.json`).pathname;
    if (!(await pathExists(rootPkgPath)))
        return { stack: "unknown", hasProducer: false, reasons: [] };
    const rootPkg = await readJsonIfPresent(rootPkgPath);
    const reasons = new Set(packageLooksLikeCoverageProducer(rootPkg));
    for (const file of await listWorkspacePackageFiles(root, rootPkg?.workspaces)) {
        const pkg = await readJsonIfPresent(file);
        for (const hit of packageLooksLikeCoverageProducer(pkg))
            reasons.add(`${file.slice(root.length + 1)}:${hit}`);
    }
    return { stack: "js-ts", hasProducer: reasons.size > 0, reasons: Array.from(reasons) };
}
async function detectSonarSourceRoots(root) {
    const roots = [];
    for (const candidate of SONAR_GENERATOR_ROOTS) {
        if (await pathExists(new URL(`file://${root}/${candidate}`).pathname))
            roots.push(candidate);
    }
    return roots;
}
async function loadWorkspaceSonarProperties(root) {
    try {
        return parseSonarProperties(await readFile(sonarPropertiesPath(root), "utf8"));
    }
    catch {
        return null;
    }
}
async function validateSonarSourceEntries(root, props) {
    const sourceEntries = splitCsv(props["sonar.sources"]);
    if (sourceEntries.length === 0)
        return 'Missing required "sonar.sources"';
    const missing = [];
    for (const entry of sourceEntries) {
        const matches = await expandWorkspacePattern(root, entry);
        if (matches.length === 0)
            missing.push(entry);
    }
    return missing.length === 0 ? undefined : `Source path${missing.length > 1 ? "s" : ""} not found: ${missing.join(", ")}`;
}
async function collectSonarPathWarnings(root, props) {
    const warnings = [];
    for (const key of ["sonar.tests", "sonar.test.inclusions", "sonar.exclusions", "sonar.test.exclusions", "sonar.coverage.exclusions"]) {
        for (const entry of splitCsv(props[key])) {
            const matches = await expandWorkspacePattern(root, entry);
            if (matches.length === 0 && key.includes("exclusions") && !/[*?[{\]]/.test(entry))
                warnings.push(`${key} entry matches nothing: ${entry}`);
        }
    }
    return warnings;
}
function coverageWithoutLcov(coverageProducer, details) {
    if (coverageProducer.stack === "js-ts") {
        details.coverage = coverageProducer.hasProducer
            ? "Coverage producer detected, but Sonar LCOV import is not configured."
            : "No LCOV import configured.";
        return "not-configured";
    }
    details.coverage = "Coverage detection is stack-specific and was not inferred.";
    return "unknown";
}
async function validateSonarCoverage(root, props, coverageProducer, details, warnings) {
    const lcovEntries = splitCsv(props["sonar.javascript.lcov.reportPaths"]);
    if (lcovEntries.length === 0)
        return coverageWithoutLcov(coverageProducer, details);
    const lcovMatches = await Promise.all(lcovEntries.map(entry => expandWorkspacePattern(root, entry)));
    const existingFiles = lcovMatches.flat();
    if (existingFiles.length > 0) {
        details.coverage = `LCOV artifact${existingFiles.length > 1 ? "s" : ""} present`;
        return "ok";
    }
    if (coverageProducer.stack === "js-ts" && coverageProducer.hasProducer) {
        details.coverage = `Coverage command detected, but ${lcovEntries.join(", ")} has not been generated yet`;
        return "artifact-missing";
    }
    if (coverageProducer.stack === "js-ts") {
        details.coverage = "Coverage import configured but no JS/TS coverage producer was detected";
        warnings.push("Coverage import configured but no coverage command was detected");
        return "producer-missing";
    }
    details.coverage = "Coverage import configured, but no matching artifact exists yet";
    return "unknown";
}
async function validateSonarProperties(root, props) {
    const warnings = [];
    const details = {};
    const coverageProducer = await detectCoverageProducer(root);
    if (!props) {
        return {
            scanner: "unknown",
            token: "unknown",
            config: "missing",
            coverage: coverageProducer.stack === "js-ts" ? "not-configured" : "unknown",
            warnings,
            details: { config: `${SONAR_PROPERTIES_FILE} is missing` },
        };
    }
    details.config = await validateSonarSourceEntries(root, props);
    warnings.push(...await collectSonarPathWarnings(root, props));
    const coverage = await validateSonarCoverage(root, props, coverageProducer, details, warnings);
    return {
        scanner: "unknown",
        token: "unknown",
        config: details.config ? "invalid" : "ok",
        coverage,
        warnings,
        details,
    };
}
function mergeSonarReadiness(base, extra) {
    return {
        scanner: extra.scanner ?? base.scanner,
        token: extra.token ?? base.token,
        config: extra.config ?? base.config,
        coverage: extra.coverage ?? base.coverage,
        warnings: Array.from(new Set([...base.warnings, ...(extra.warnings ?? [])])),
        details: { ...base.details, ...extra.details },
    };
}
function probeSonarScanner(root) {
    const scanner = runCommand("sonar-scanner", ["--version"], root);
    return {
        scanner: scanner.ok ? "ok" : "missing",
        details: {
            scanner: scanner.ok
                ? scanner.stdout.split(/\r?\n/)[0] || "sonar-scanner available"
                : scanner.stderr || "sonar-scanner is not available on PATH",
        },
    };
}
function sonarBearerAuthHeader(token) {
    return { authorization: `Bearer ${token}` };
}
function sonarBasicAuthHeader(token) {
    const auth = Buffer.from(`${token}:`).toString("base64");
    return { authorization: `Basic ${auth}` };
}
async function fetchSonarWithAuth(url, init) {
    const { token, headers, timeoutMs = 5000, ...rest } = init;
    const bearer = await fetch(url, {
        ...rest,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { ...headers, ...sonarBearerAuthHeader(token) },
    });
    if (bearer.status !== 401)
        return bearer;
    return fetch(url, {
        ...rest,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { ...headers, ...sonarBasicAuthHeader(token) },
    });
}
async function validateSonarToken(token, host = SONAR_DEFAULT_HOST) {
    try {
        const response = await fetchSonarWithAuth(`${host}/api/authentication/validate`, { token, timeoutMs: 5000 });
        if (!response.ok)
            return false;
        const body = await response.json();
        return body.valid === true;
    }
    catch {
        return false;
    }
}
async function sonarProjectExists(token, organization, projectKey, host = SONAR_DEFAULT_HOST) {
    try {
        const url = new URL(`${host}/api/projects/search`);
        url.searchParams.set("organization", organization);
        url.searchParams.set("projects", projectKey);
        const response = await fetchSonarWithAuth(url, { token, timeoutMs: 5000 });
        if (!response.ok)
            return false;
        const body = await response.json();
        return Array.isArray(body.components) && body.components.length > 0;
    }
    catch {
        return false;
    }
}
async function createSonarProject(token, organization, projectKey, name, visibility = "private", host = SONAR_DEFAULT_HOST) {
    try {
        if (await sonarProjectExists(token, organization, projectKey, host))
            return { ok: true, created: false, reason: "already-exists" };
        const url = new URL(`${host}/api/projects/create`);
        url.searchParams.set("organization", organization);
        url.searchParams.set("project", projectKey);
        url.searchParams.set("name", name);
        url.searchParams.set("visibility", visibility);
        const response = await fetchSonarWithAuth(url, { token, method: "POST", timeoutMs: 8000 });
        if (response.ok)
            return { ok: true, created: true };
        const detail = await response.text().catch(() => "");
        return { ok: false, reason: `HTTP ${response.status}: ${detail.slice(0, 200)}` };
    }
    catch (err) {
        return { ok: false, reason: err.message };
    }
}
async function sonarPost(token, path, params, host = SONAR_DEFAULT_HOST) {
    try {
        const url = new URL(`${host}${path}`);
        for (const [k, v] of Object.entries(params))
            url.searchParams.set(k, v);
        const response = await fetchSonarWithAuth(url, { token, method: "POST", timeoutMs: 8000 });
        if (response.ok)
            return { ok: true, status: response.status, detail: "" };
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        return { ok: false, status: response.status, detail };
    }
    catch (err) {
        return { ok: false, status: 0, detail: err.message };
    }
}
async function findSonarQualityGateId(token, organization, gateName, host = SONAR_DEFAULT_HOST) {
    try {
        const url = new URL(`${host}/api/qualitygates/list`);
        url.searchParams.set("organization", organization);
        const response = await fetchSonarWithAuth(url, { token, timeoutMs: 5000 });
        if (!response.ok)
            return undefined;
        const body = await response.json();
        const hit = (body.qualitygates ?? []).find(g => g.name === gateName);
        if (hit?.id === undefined)
            return undefined;
        return String(hit.id);
    }
    catch {
        return undefined;
    }
}
async function assignSonarQualityGate(token, organization, projectKey, gateName, host = SONAR_DEFAULT_HOST) {
    const gateId = await findSonarQualityGateId(token, organization, gateName, host);
    if (!gateId)
        return { ok: false, reason: `quality gate "${gateName}" not found in ${organization}` };
    const result = await sonarPost(token, "/api/qualitygates/select", { organization, projectKey, gateId }, host);
    if (result.ok)
        return { ok: true, reason: "" };
    return { ok: false, reason: `HTTP ${result.status}: ${result.detail}` };
}
async function disableSonarAutoScan(token, projectKey, host = SONAR_DEFAULT_HOST) {
    const result = await sonarPost(token, "/api/autoscan/activation", { projectKey, enable: "false" }, host);
    if (result.ok)
        return { ok: true, reason: "" };
    return { ok: false, reason: `HTTP ${result.status}: ${result.detail}` };
}
function buildSonarReadiness(localSonarReadiness, scannerReadiness, tokenValue, sonarValid, sonarHost) {
    let tokenStatus = "missing";
    let tokenDetail = "SONAR_TOKEN was not found in env, .env.local, or repo git config";
    if (tokenValue) {
        tokenStatus = sonarValid ? "ok" : "invalid";
        tokenDetail = sonarValid ? `SONAR_TOKEN validated against ${sonarHost}` : `SONAR_TOKEN failed validation against ${sonarHost}`;
    }
    return mergeSonarReadiness(localSonarReadiness, {
        scanner: scannerReadiness.scanner,
        token: tokenStatus,
        details: { ...scannerReadiness.details, token: tokenDetail },
    });
}
function classifySonarStatus(tokenValue, sonarValid, localSonarReadiness, sonarEnabled) {
    if (!tokenValue)
        return sonarEnabled || localSonarReadiness.config !== "missing" ? "missing" : "skipped";
    if (!sonarEnabled && localSonarReadiness.config === "missing")
        return sonarValid ? "ok" : "invalid";
    if (sonarValid && localSonarReadiness.config === "ok")
        return "ok";
    if (localSonarReadiness.config === "missing")
        return "missing";
    return "invalid";
}
function sonarDetail(tokenValue, sonarValid, localSonarReadiness, sonarReadiness) {
    if (localSonarReadiness.config === "invalid")
        return localSonarReadiness.details?.config;
    if (tokenValue && sonarValid)
        return sonarReadiness.details?.coverage;
    if (tokenValue)
        return "SONAR_TOKEN failed Sonar validation";
    return "SONAR_TOKEN was not found in env, .env.local, or repo git config";
}
async function resolveWorkspaceSonarPreflight(root, options) {
    const sonarToken = await detectSonarToken(root);
    const sonarHost = options.sonarHostUrl ?? SONAR_DEFAULT_HOST;
    const sonarValid = sonarToken.value ? await validateSonarToken(sonarToken.value, sonarHost) : undefined;
    const localSonarReadiness = await validateSonarProperties(root, await loadWorkspaceSonarProperties(root));
    const sonarReadiness = buildSonarReadiness(localSonarReadiness, probeSonarScanner(root), sonarToken.value, sonarValid, sonarHost);
    return {
        status: classifySonarStatus(sonarToken.value, sonarValid, localSonarReadiness, options.sonarEnabled),
        tokenSource: sonarToken.source,
        tokenValid: sonarValid,
        readiness: sonarReadiness,
        detail: sonarDetail(sonarToken.value, sonarValid, localSonarReadiness, sonarReadiness),
    };
}
function resolveWorkspaceGithubPreflight(root, gitProbe, defaultBranch) {
    const remoteProbe = gitProbe.ok ? runGit(["remote", "get-url", "origin"], root) : { ok: false, stdout: "", stderr: "" };
    const parsedRemote = remoteProbe.ok ? parseGitHubRemote(remoteProbe.stdout) : null;
    return parsedRemote
        ? { status: "ok", owner: parsedRemote.owner, repo: parsedRemote.repo, defaultBranch, remoteUrl: remoteProbe.stdout }
        : {
            status: remoteProbe.ok ? "invalid" : "missing",
            detail: remoteProbe.ok ? "origin is not a GitHub remote" : remoteProbe.stderr || "origin remote is not configured",
            defaultBranch,
            remoteUrl: remoteProbe.ok ? remoteProbe.stdout : undefined,
        };
}
function resolveWorkspaceGhPreflight(root) {
    const ghVersion = runCommand("gh", ["--version"], root);
    const ghStatus = ghVersion.ok ? runCommand("gh", ["auth", "status"], root) : { ok: false, stdout: "", stderr: "gh unavailable" };
    if (!ghStatus.ok) {
        return { status: ghVersion.ok ? "missing" : "skipped", detail: ghVersion.ok ? (ghStatus.stderr || "gh auth status failed") : "GitHub CLI is not available" };
    }
    const userProbe = runCommand("gh", ["api", "user", "--jq", ".login"], root);
    return { status: "ok", user: userProbe.ok ? userProbe.stdout : undefined };
}
export async function runWorkspacePreflight(root, options = {}) {
    const gitProbe = runGit(["rev-parse", "--is-inside-work-tree"], root);
    const defaultBranch = gitProbe.ok ? resolveGitDefaultBranch(root) : null;
    const github = resolveWorkspaceGithubPreflight(root, gitProbe, defaultBranch);
    const gh = resolveWorkspaceGhPreflight(root);
    const sonar = await resolveWorkspaceSonarPreflight(root, options);
    const coderabbitCli = runCommand("coderabbit", ["--version"], root);
    const crCli = coderabbitCli.ok ? coderabbitCli : runCommand("cr", ["--version"], root);
    return {
        report: {
            git: {
                status: gitProbe.ok && gitProbe.stdout === "true" ? "ok" : "missing",
                detail: gitProbe.ok ? undefined : (gitProbe.stderr || undefined),
            },
            github,
            gh,
            sonar,
            coderabbit: crCli.ok
                ? { status: "ok", detail: `CodeRabbit CLI available (${crCli.stdout.split(/\r?\n/)[0] || "unknown version"})` }
                : { status: "missing", detail: "CodeRabbit CLI not found — install with `npm i -g @coderabbit/cli`" },
            checkedAt: new Date().toISOString(),
        },
    };
}
async function buildGeneratedSonarProperties(root, owner, repo) {
    const sourceRoots = await detectSonarSourceRoots(root);
    if (sourceRoots.length === 0) {
        return { warnings: ["Sonar config generation skipped: no supported source roots were detected. Add sonar-project.properties manually if your repo uses a non-standard layout."] };
    }
    const coverageProducer = await detectCoverageProducer(root);
    const lines = [
        `sonar.projectKey=${owner}_${repo}`,
        `sonar.organization=${owner}`,
        `sonar.sources=${sourceRoots.join(",")}`,
        "sonar.tests=.",
        `sonar.test.inclusions=${SONAR_DEFAULT_TEST_INCLUSIONS}`,
        `sonar.exclusions=${SONAR_DEFAULT_EXCLUSIONS}`,
    ];
    if (coverageProducer.stack === "js-ts" && coverageProducer.hasProducer)
        lines.push(`sonar.javascript.lcov.reportPaths=${SONAR_DEFAULT_LCOV_PATH}`);
    return { content: `${lines.join("\n")}\n`, warnings: [] };
}
export async function writeSonarProperties(root, owner, repo) {
    if (await pathExists(sonarPropertiesPath(root)))
        return { changed: false, warnings: [] };
    const generated = await buildGeneratedSonarProperties(root, owner, repo);
    if (!generated.content)
        return { changed: false, warnings: generated.warnings };
    await mkdir(root, { recursive: true });
    await writeFile(sonarPropertiesPath(root), generated.content, "utf8");
    return { changed: true, warnings: generated.warnings };
}
export async function previewWorkspace(path, config, repos) {
    const base = await buildPathPreview(path, config.allowedRoots, readWorkspaceConfig);
    const registeredByPath = repos.getWorkspaceByRootPath(base.path);
    return { ...base, isRegistered: Boolean(registeredByPath) };
}
export async function provisionSonarProject(path, name, sonar, actions, warnings) {
    const token = (await detectSonarToken(path)).value;
    if (!token) {
        warnings.push("SonarCloud project creation skipped: SONAR_TOKEN not available");
        return;
    }
    if (!sonar.organization || !sonar.projectKey)
        return;
    const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST;
    const create = await createSonarProject(token, sonar.organization, sonar.projectKey, name, "private", host);
    const projectReady = create.ok;
    if (create.ok && create.created)
        actions.push(`created SonarCloud project ${sonar.organization}/${sonar.projectKey}`);
    else if (create.ok && !create.created)
        actions.push(`SonarCloud project ${sonar.organization}/${sonar.projectKey} already exists`);
    else
        warnings.push(`SonarCloud project create failed: ${create.reason}`);
    if (!projectReady)
        return;
    const gateName = sonar.qualityGateName ?? "Sonar way for AI Code";
    const gate = await assignSonarQualityGate(token, sonar.organization, sonar.projectKey, gateName, host);
    if (gate.ok)
        actions.push(`applied SonarCloud quality gate "${gateName}"`);
    else
        warnings.push(`SonarCloud quality gate "${gateName}" not applied: ${gate.reason}`);
    const autoscan = await disableSonarAutoScan(token, sonar.projectKey, host);
    if (autoscan.ok)
        actions.push("disabled SonarCloud automatic analysis");
    else
        warnings.push(`SonarCloud automatic analysis not disabled: ${autoscan.reason}`);
}
