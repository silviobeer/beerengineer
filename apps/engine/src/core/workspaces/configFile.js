import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_WORKSPACE_RUNTIME_POLICY } from "../../types/workspace.js";
import { SONAR_DEFAULT_HOST, WORKSPACE_SCHEMA_VERSION, safeParseHarnessProfile, toJson, workspaceConfigPath, } from "./shared.js";
function normalizeSonarConfig(config, key, defaultOrg) {
    if (!config?.enabled)
        return { enabled: false };
    const region = config.region ?? "eu";
    return {
        enabled: true,
        projectKey: config.projectKey ?? key,
        organization: config.organization ?? defaultOrg,
        hostUrl: config.hostUrl ?? (region === "us" ? "https://sonarqube.us" : SONAR_DEFAULT_HOST),
        region,
        planTier: config.planTier ?? "unknown",
        baseBranch: config.baseBranch,
        scanTimeoutMs: config.scanTimeoutMs,
        qualityGateName: config.qualityGateName,
    };
}
function normalizeReviewPolicy(policy, legacySonar, key, defaultOrg, coderabbitCliAvailable = false) {
    const coderabbitExplicit = policy?.coderabbit?.enabled;
    return {
        coderabbit: {
            enabled: coderabbitExplicit === false ? false : (coderabbitExplicit === true || coderabbitCliAvailable),
        },
        sonarcloud: normalizeSonarConfig(legacySonar, key, defaultOrg),
    };
}
function isRuntimePolicyMode(value) {
    return value === "safe-readonly" || value === "safe-workspace-write" || value === "unsafe-autonomous-write";
}
export function defaultWorkspaceRuntimePolicy() {
    return { ...DEFAULT_WORKSPACE_RUNTIME_POLICY };
}
function normalizeRuntimePolicy(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const policy = raw;
    if (!isRuntimePolicyMode(policy.stageAuthoring) ||
        policy.reviewer !== "safe-readonly" ||
        !isRuntimePolicyMode(policy.coderExecution) ||
        (policy.stageAuthoring !== "safe-readonly" && policy.stageAuthoring !== "safe-workspace-write") ||
        (policy.coderExecution !== "safe-workspace-write" && policy.coderExecution !== "unsafe-autonomous-write")) {
        return null;
    }
    return {
        stageAuthoring: policy.stageAuthoring,
        reviewer: policy.reviewer,
        coderExecution: policy.coderExecution,
    };
}
function normalizePreviewConfig(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const preview = raw;
    if (typeof preview.command !== "string" || preview.command.trim().length === 0)
        return undefined;
    return {
        command: preview.command.trim(),
        cwd: typeof preview.cwd === "string" && preview.cwd.trim().length > 0 ? preview.cwd.trim() : undefined,
    };
}
function isValidHarnessProfile(raw) {
    if (!raw || typeof raw !== "object")
        return false;
    const mode = raw.mode;
    switch (mode) {
        case "codex-first":
        case "claude-first":
        case "codex-only":
        case "claude-only":
        case "fast":
        case "claude-sdk-first":
        case "codex-sdk-first":
        case "opencode-china":
        case "opencode-euro":
            return true;
        case "opencode":
        case "self": {
            const roles = raw.roles;
            if (!roles || typeof roles !== "object")
                return false;
            const coder = roles.coder;
            const reviewer = roles.reviewer;
            return !!coder && typeof coder === "object" && !!reviewer && typeof reviewer === "object";
        }
        default:
            return false;
    }
}
export function buildWorkspaceConfigFile(input) {
    return {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        key: input.key,
        name: input.name,
        harnessProfile: input.harnessProfile,
        runtimePolicy: input.runtimePolicy ?? defaultWorkspaceRuntimePolicy(),
        preview: input.preview,
        sonar: input.sonar,
        reviewPolicy: input.reviewPolicy ?? normalizeReviewPolicy(undefined, input.sonar, input.key),
        preflight: input.preflight,
        createdAt: input.createdAt ?? Date.now(),
    };
}
export async function readWorkspaceConfig(root) {
    try {
        const raw = JSON.parse(await readFile(workspaceConfigPath(root), "utf8"));
        if ((raw.schemaVersion !== 1 && raw.schemaVersion !== WORKSPACE_SCHEMA_VERSION) || typeof raw.key !== "string" || typeof raw.name !== "string") {
            return null;
        }
        if (!isValidHarnessProfile(raw.harnessProfile))
            return null;
        const runtimePolicy = normalizeRuntimePolicy(raw.runtimePolicy) ?? defaultWorkspaceRuntimePolicy();
        const preview = normalizePreviewConfig(raw.preview);
        const sonar = normalizeSonarConfig(raw.sonar && typeof raw.sonar === "object" ? raw.sonar : undefined, raw.key);
        const reviewPolicy = raw.reviewPolicy && typeof raw.reviewPolicy === "object" ? raw.reviewPolicy : undefined;
        return {
            schemaVersion: WORKSPACE_SCHEMA_VERSION,
            key: raw.key,
            name: raw.name,
            harnessProfile: raw.harnessProfile,
            runtimePolicy,
            preview,
            sonar,
            reviewPolicy: normalizeReviewPolicy(reviewPolicy, sonar, raw.key),
            preflight: raw.preflight && typeof raw.preflight === "object" ? raw.preflight : undefined,
            createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
        };
    }
    catch {
        return null;
    }
}
export async function writeWorkspaceConfig(root, config) {
    await mkdir(dirname(workspaceConfigPath(root)), { recursive: true });
    await writeFile(workspaceConfigPath(root), toJson(config), "utf8");
}
export function generateSonarProjectUrl(name, sonar) {
    if (!sonar.enabled || !sonar.organization || !sonar.projectKey)
        return undefined;
    const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST;
    if (host !== SONAR_DEFAULT_HOST)
        return undefined;
    const params = new URLSearchParams({
        organization: sonar.organization,
        name,
        key: sonar.projectKey,
    });
    return `${SONAR_DEFAULT_HOST}/projects/create?${params.toString()}`;
}
export function generateSonarMcpSnippet(sonar) {
    if (!sonar.enabled)
        return undefined;
    const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST;
    const args = ["run", "--rm", "-i", "--init", "--pull=always", "-e", "SONARQUBE_TOKEN"];
    const env = ['"SONARQUBE_TOKEN" = "<YourSonarQubeUserToken>"'];
    const isCloudHost = host === SONAR_DEFAULT_HOST || host === "https://sonarqube.us";
    if (isCloudHost) {
        args.push("-e", "SONARQUBE_ORG");
        env.push(`"SONARQUBE_ORG" = "${sonar.organization ?? "<YourOrganizationName>"}"`);
    }
    if (host !== SONAR_DEFAULT_HOST) {
        args.push("-e", "SONARQUBE_URL");
        env.push(`"SONARQUBE_URL" = "${host}"`);
    }
    args.push("mcp/sonarqube");
    return [
        "# See https://docs.sonarsource.com/sonarqube-mcp-server/quickstart-guide/codex-cli",
        "[mcp_servers.sonarqube]",
        'command = "docker"',
        `args = [${args.map(value => JSON.stringify(value)).join(", ")}]`,
        `env = { ${env.join(", ")} }`,
    ].join("\n");
}
export function previewConfigFromDbRow(root, harnessProfileJson, row) {
    const parsed = safeParseHarnessProfile(harnessProfileJson);
    if (!parsed.profile)
        return null;
    return buildWorkspaceConfigFile({
        key: row.key,
        name: row.name,
        harnessProfile: parsed.profile,
        sonar: { enabled: row.sonar_enabled === 1 },
        createdAt: row.created_at,
    });
}
export { normalizeReviewPolicy, normalizeSonarConfig };
