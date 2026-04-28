import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { access, glob, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
export const WORKSPACE_SCHEMA_VERSION = 2;
export const SONAR_DEFAULT_HOST = "https://sonarcloud.io";
export const WORKSPACE_CONFIG_DIR = ".beerengineer";
export const WORKSPACE_CONFIG_FILE = "workspace.json";
export const SONAR_PROPERTIES_FILE = "sonar-project.properties";
export const GITIGNORE_FILE = ".gitignore";
export const SONAR_WORKFLOW_FILE = ".github/workflows/sonar.yml";
export const CODERABBIT_CONFIG_FILE = ".coderabbit.yaml";
export const BEERENGINEER_GITIGNORE_ENTRIES = [
    ".env.local",
    ".beerengineer/workspaces/",
    ".beerengineer/worktrees/",
    ".beerengineer/cache/",
];
export function toJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
export function slugify(input) {
    const core = input
        .trim()
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-+|-+$/g, "");
    if (core)
        return core;
    return `workspace-${randomBytes(3).toString("hex")}`;
}
export function workspaceConfigPath(root) {
    return resolve(root, WORKSPACE_CONFIG_DIR, WORKSPACE_CONFIG_FILE);
}
export function sonarPropertiesPath(root) {
    return resolve(root, SONAR_PROPERTIES_FILE);
}
export function gitignorePath(root) {
    return resolve(root, GITIGNORE_FILE);
}
export function sonarWorkflowPath(root) {
    return resolve(root, SONAR_WORKFLOW_FILE);
}
export function coderabbitConfigPath(root) {
    return resolve(root, CODERABBIT_CONFIG_FILE);
}
export async function pathExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
export function splitCsv(value) {
    return (value ?? "")
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean);
}
export function hasGlobMagic(value) {
    return /[*?[{\]]/.test(value);
}
export function parseSonarProperties(raw) {
    const props = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0)
            continue;
        props[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return props;
}
export async function collectGlobMatches(iterator) {
    const matches = [];
    for await (const match of iterator)
        matches.push(match);
    return matches;
}
export async function expandWorkspacePattern(root, pattern) {
    if (!pattern.trim())
        return [];
    if (!hasGlobMagic(pattern)) {
        const absolute = resolve(root, pattern);
        return await pathExists(absolute) ? [absolute] : [];
    }
    const matches = await collectGlobMatches(glob(pattern, {
        cwd: root,
        exclude: path => path.includes(`${sep}node_modules${sep}`),
    }));
    return matches.map(match => resolve(root, match));
}
export async function readJsonIfPresent(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return null;
    }
}
export async function listWorkspacePackageFiles(root, rawWorkspaces) {
    let patterns = [];
    if (Array.isArray(rawWorkspaces)) {
        patterns = rawWorkspaces.filter((value) => typeof value === "string");
    }
    else if (rawWorkspaces && typeof rawWorkspaces === "object" && Array.isArray(rawWorkspaces.packages)) {
        patterns = rawWorkspaces.packages.filter((value) => typeof value === "string");
    }
    const files = new Set();
    for (const pattern of patterns) {
        for (const match of await collectGlobMatches(glob(pattern.replace(/\/?$/, "/package.json"), { cwd: root }))) {
            files.add(resolve(root, match));
        }
    }
    return Array.from(files);
}
export function packageLooksLikeCoverageProducer(pkg) {
    if (!pkg)
        return [];
    const hits = [];
    const scripts = pkg.scripts ?? {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, script] of Object.entries(scripts)) {
        const lower = script.toLowerCase();
        if (name === "coverage")
            hits.push(`script:${name}`);
        if (/\b(c8|vitest)\b/.test(lower))
            hits.push(`script:${name}`);
        if (lower.includes("--coverage"))
            hits.push(`script:${name}`);
    }
    if (deps.c8)
        hits.push("dependency:c8");
    if (deps.vitest)
        hits.push("dependency:vitest");
    return Array.from(new Set(hits));
}
export async function isWritablePath(path) {
    try {
        await access(path, constants.W_OK);
        return true;
    }
    catch {
        return false;
    }
}
export async function findWritableParent(path) {
    let cursor = resolve(path);
    while (true) {
        if (await pathExists(cursor))
            return isWritablePath(cursor);
        const parent = dirname(cursor);
        if (parent === cursor)
            return false;
        cursor = parent;
    }
}
export function isContained(child, parent) {
    if (child === parent)
        return true;
    const rel = relative(parent, child);
    if (!rel || rel === "")
        return true;
    if (rel.startsWith(".."))
        return false;
    return !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
}
export function isInsideAllowedRoot(path, allowedRoots) {
    return allowedRoots.some(root => isContained(path, resolve(root)));
}
export async function realpathOrResolve(path) {
    try {
        return await realpath(path);
    }
    catch {
        return resolve(path);
    }
}
export async function isInsideAllowedRootRealpath(path, allowedRoots) {
    const resolvedChild = await realpathOrResolve(path);
    for (const root of allowedRoots) {
        const resolvedRoot = await realpathOrResolve(root);
        if (isContained(resolvedChild, resolvedRoot))
            return true;
    }
    return false;
}
function hasGitIdentityConfigured(cwd) {
    const email = spawnSync("git", ["config", "--get", "user.email"], { cwd, encoding: "utf8" });
    const name = spawnSync("git", ["config", "--get", "user.name"], { cwd, encoding: "utf8" });
    return email.status === 0 && !!email.stdout?.trim() && name.status === 0 && !!name.stdout?.trim();
}
export function runGit(args, cwd) {
    let env = process.env;
    if (args[0] === "commit") {
        const hasEnvIdentity = process.env.GIT_AUTHOR_EMAIL && process.env.GIT_AUTHOR_NAME;
        if (!hasEnvIdentity && !hasGitIdentityConfigured(cwd)) {
            env = {
                ...process.env,
                GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "beerengineer_",
                GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "beerengineer@example.invalid",
                GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "beerengineer_",
                GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "beerengineer@example.invalid",
            };
        }
    }
    const result = spawnSync("git", args, { cwd, encoding: "utf8", env });
    return {
        ok: result.status === 0,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
    };
}
export function runCommand(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    return {
        ok: result.status === 0,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
    };
}
export function readEnvFileValue(raw, key) {
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const match = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(trimmed);
        if (match?.[1] !== key)
            continue;
        const value = match[2].trim();
        return value.replaceAll(/^['"]|['"]$/g, "");
    }
    return undefined;
}
export function parseGitHubRemote(remoteUrl) {
    const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl);
    if (ssh)
        return { owner: ssh[1], repo: ssh[2] };
    const https = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
    if (https)
        return { owner: https[1], repo: https[2] };
    return null;
}
function isEngineOwnedBranch(branch) {
    return /^(item|proj|wave|story|candidate)\//.test(branch);
}
export function resolveGitDefaultBranch(root) {
    const originHead = runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root);
    if (originHead.ok && originHead.stdout)
        return originHead.stdout.replace(/^origin\//, "") || null;
    const remoteShow = runGit(["remote", "show", "origin"], root);
    if (remoteShow.ok) {
        const match = /^\s*HEAD branch:\s+(.+)$/m.exec(remoteShow.stdout);
        const branch = match?.[1]?.trim();
        if (branch)
            return branch;
    }
    const currentBranch = runGit(["branch", "--show-current"], root);
    if (currentBranch.ok && currentBranch.stdout && !isEngineOwnedBranch(currentBranch.stdout)) {
        return currentBranch.stdout;
    }
    for (const candidate of ["main", "master"]) {
        if (runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`], root).ok)
            return candidate;
    }
    return null;
}
function readGitConfigSonarToken(root) {
    const probe = runGit(["config", "--get", "beerengineer.sonarToken"], root);
    const value = probe.ok ? probe.stdout.trim() : "";
    return value || undefined;
}
export async function detectSonarToken(root) {
    if (process.env.SONAR_TOKEN)
        return { value: process.env.SONAR_TOKEN, source: "env" };
    try {
        const envLocal = await readFile(resolve(root, ".env.local"), "utf8");
        const value = readEnvFileValue(envLocal, "SONAR_TOKEN");
        if (value)
            return { value, source: ".env.local" };
    }
    catch {
        // ignore
    }
    const gitConfigValue = readGitConfigSonarToken(root);
    if (gitConfigValue)
        return { value: gitConfigValue, source: "git-config" };
    return {};
}
export function persistSonarTokenToGitConfig(root, token) {
    const result = runGit(["config", "--local", "beerengineer.sonarToken", token], root);
    if (!result.ok)
        throw new Error(result.stderr || "failed to persist SONAR_TOKEN to git config");
}
export function safeParseHarnessProfile(raw) {
    try {
        return { profile: JSON.parse(raw) };
    }
    catch (err) {
        return { profile: null, error: err.message };
    }
}
export function previewFromDbRow(row) {
    const parsed = safeParseHarnessProfile(row.harness_profile_json);
    return {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        key: row.key,
        name: row.name,
        rootPath: row.root_path ?? "",
        harnessProfile: parsed.profile,
        harnessProfileInvalid: parsed.error,
        sonarEnabled: row.sonar_enabled === 1,
        createdAt: row.created_at,
        lastOpenedAt: row.last_opened_at,
    };
}
export function renderSonarWorkflow() {
    return [
        "name: SonarCloud",
        "",
        "on:",
        "  push:",
        "    branches:",
        "      - main",
        "  pull_request:",
        "",
        "jobs:",
        "  sonarcloud:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 22",
        "      - name: SonarCloud Scan",
        "        uses: SonarSource/sonarqube-scan-action@v5",
        "        env:",
        "          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}",
    ].join("\n") + "\n";
}
export function renderCoderabbitConfig() {
    return [
        "reviews:",
        "  profile: chill",
        "  request_changes_workflow: false",
        "  auto_review:",
        "    enabled: true",
        "    drafts: false",
        "language: en-US",
    ].join("\n") + "\n";
}
export function generateCodeRabbitInstallUrl() {
    return "https://github.com/apps/coderabbitai/installations/new";
}
export function detectStack(entries) {
    const names = new Set(entries);
    if (names.has("next.config.ts") || names.has("next.config.js"))
        return "next";
    if (names.has("package.json"))
        return "node";
    if (names.has("pyproject.toml") || names.has("requirements.txt") || names.has("manage.py"))
        return "python";
    if (names.has("Cargo.toml"))
        return "rust";
    return null;
}
export async function readTopLevelEntries(path, exists, isDirectory) {
    if (!exists || !isDirectory)
        return [];
    return (await (await import("node:fs/promises")).readdir(path)).slice(0, 20);
}
export function probeGitRepoState(path, exists, isDirectory) {
    if (!exists || !isDirectory)
        return { ok: false, stdout: "", stderr: "" };
    return runGit(["rev-parse", "--is-inside-work-tree"], path);
}
export async function ensureManagedGitignore(root) {
    const path = gitignorePath(root);
    const exists = await pathExists(path);
    const current = exists ? await readFile(path, "utf8") : "";
    const existingLines = new Set(current.split(/\r?\n/).map(line => line.trim()));
    const missing = BEERENGINEER_GITIGNORE_ENTRIES.filter(entry => !existingLines.has(entry));
    if (missing.length === 0)
        return { changed: false };
    const prefix = current.length > 0 && !current.endsWith("\n") ? `${current}\n` : current;
    const body = exists
        ? `${prefix}${missing.join("\n")}\n`
        : `# beerengineer_ managed\n${BEERENGINEER_GITIGNORE_ENTRIES.join("\n")}\n`;
    await writeFile(path, body, "utf8");
    return { changed: true };
}
export async function writeFileIfMissing(path, content) {
    if (await pathExists(path))
        return false;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    return true;
}
export async function buildPathPreview(path, allowedRoots, readWorkspaceConfig) {
    const resolvedPath = resolve(path);
    const exists = await pathExists(resolvedPath);
    const stats = exists ? await stat(resolvedPath) : null;
    const isDirectory = stats?.isDirectory() ?? false;
    const topLevelEntries = await readTopLevelEntries(resolvedPath, exists, isDirectory);
    const isWritable = exists ? await isWritablePath(resolvedPath) : await findWritableParent(resolvedPath);
    const gitProbe = probeGitRepoState(resolvedPath, exists, isDirectory);
    const isGitRepo = gitProbe.ok && gitProbe.stdout === "true";
    const defaultBranch = isGitRepo ? resolveGitDefaultBranch(resolvedPath) : null;
    const remoteProbe = isGitRepo ? runGit(["remote"], resolvedPath) : { ok: false, stdout: "", stderr: "" };
    const hasRemote = Boolean(remoteProbe.stdout);
    const configFile = exists && isDirectory ? await readWorkspaceConfig(resolvedPath) : null;
    const hasSonarProperties = exists && isDirectory ? await pathExists(sonarPropertiesPath(resolvedPath)) : false;
    const insideAllowedRoot = isInsideAllowedRoot(resolvedPath, allowedRoots);
    const conflicts = [];
    if (exists && !isDirectory)
        conflicts.push("path is not a directory");
    if (!isWritable)
        conflicts.push("path is not writable");
    if (!insideAllowedRoot)
        conflicts.push("path is outside allowed roots");
    return {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        path: resolvedPath,
        exists,
        isDirectory,
        isWritable,
        isGitRepo,
        hasRemote,
        defaultBranch,
        detectedStack: detectStack(topLevelEntries),
        existingFiles: topLevelEntries,
        isInsideAllowedRoot: insideAllowedRoot,
        isGreenfield: !exists || (isDirectory && topLevelEntries.length === 0),
        hasWorkspaceConfigFile: Boolean(configFile),
        hasSonarProperties,
        conflicts,
    };
}
export async function ensureGitRepo(root, defaultBranch, initGit) {
    const insideRepo = runGit(["rev-parse", "--is-inside-work-tree"], root);
    if (insideRepo.ok && insideRepo.stdout === "true") {
        return { ok: true, actions: [] };
    }
    const init = await initGit(root, { defaultBranch, initialCommit: false });
    if (!init.ok)
        return init;
    const head = runGit(["rev-parse", "--verify", "HEAD"], root);
    const actions = [...init.actions];
    if (!head.ok) {
        const commit = runGit(["commit", "--allow-empty", "-m", "Initial repository commit"], root);
        if (!commit.ok)
            return { ok: false, actions, detail: commit.stderr || "git commit failed" };
        actions.push("git initial empty commit");
    }
    return { ok: true, actions };
}
