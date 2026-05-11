import { mkdir, readFile, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { DEFAULT_WORKSPACE_RUNTIME_POLICY, defaultRuntimePolicyForHarnessProfile } from "../../types/workspace.js"
import type {
  HarnessProfile,
  RuntimePolicyMode,
  SonarConfig,
  WorkspaceConfigFile,
  WorkspacePreviewConfig,
  WorkspacePreflightReport,
  WorkspaceReviewPolicy,
  WorkspaceRuntimePolicy,
  WorkspaceTelegramInboundConfig,
} from "../../types/workspace.js"
import {
  SONAR_DEFAULT_HOST,
  WORKSPACE_SCHEMA_VERSION,
  safeParseHarnessProfile,
  toJson,
  workspaceConfigPath,
} from "./shared.js"

function normalizeSonarConfig(config: SonarConfig | undefined, key: string, defaultOrg?: string): SonarConfig {
  if (!config?.enabled) return { enabled: false }
  const region = config.region ?? "eu"
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
  }
}

function normalizeReviewPolicy(
  policy: WorkspaceReviewPolicy | undefined,
  legacySonar: SonarConfig | undefined,
  key: string,
  defaultOrg?: string,
  coderabbitCliAvailable: boolean = false,
): WorkspaceReviewPolicy {
  const coderabbitExplicit = policy?.coderabbit?.enabled
  const sonarcloud = policy?.sonarcloud ? mergeDefined(legacySonar, policy.sonarcloud) : legacySonar
  return {
    coderabbit: {
      enabled: coderabbitExplicit === false ? false : (coderabbitExplicit === true || coderabbitCliAvailable),
    },
    sonarcloud: normalizeSonarConfig(sonarcloud, key, defaultOrg),
  }
}

function mergeDefined<T extends Record<string, unknown>>(base: T | undefined, override: T): T {
  const merged = base ? { ...base } : {} as T
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

function isRuntimePolicyMode(value: unknown): value is RuntimePolicyMode {
  return value === "safe-readonly" || value === "safe-workspace-write" || value === "unsafe-autonomous-write"
}

export function defaultWorkspaceRuntimePolicy(): WorkspaceRuntimePolicy {
  return { ...DEFAULT_WORKSPACE_RUNTIME_POLICY }
}

export function defaultWorkspaceRuntimePolicyForHarnessProfile(profile: HarnessProfile): WorkspaceRuntimePolicy {
  return defaultRuntimePolicyForHarnessProfile(profile)
}

function normalizeRuntimePolicy(raw: unknown): WorkspaceRuntimePolicy | null {
  if (!raw || typeof raw !== "object") return null
  const policy = raw as Partial<WorkspaceRuntimePolicy>
  if (
    !isRuntimePolicyMode(policy.stageAuthoring) ||
    policy.reviewer !== "safe-readonly" ||
    !isRuntimePolicyMode(policy.coderExecution) ||
    (policy.stageAuthoring !== "safe-readonly" && policy.stageAuthoring !== "safe-workspace-write") ||
    (policy.coderExecution !== "safe-workspace-write" && policy.coderExecution !== "unsafe-autonomous-write")
  ) {
    return null
  }
  return {
    stageAuthoring: policy.stageAuthoring,
    reviewer: policy.reviewer,
    coderExecution: policy.coderExecution,
  }
}

function normalizePreviewConfig(raw: unknown): WorkspacePreviewConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const preview = raw as Partial<WorkspacePreviewConfig>
  if (typeof preview.command !== "string" || preview.command.trim().length === 0) return undefined
  return {
    command: preview.command.trim(),
    cwd: typeof preview.cwd === "string" && preview.cwd.trim().length > 0 ? preview.cwd.trim() : undefined,
  }
}

function nonEmptyTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeWorkspaceTelegramInbound(
  raw: WorkspaceTelegramInboundConfig["inbound"],
): WorkspaceTelegramInboundConfig["inbound"] | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const webhookSecretEnv = nonEmptyTrimmedString(raw.webhookSecretEnv)
  const normalized: NonNullable<WorkspaceTelegramInboundConfig["inbound"]> = {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(webhookSecretEnv ? { webhookSecretEnv } : {}),
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeWorkspaceTelegramConfig(raw: unknown): WorkspaceTelegramInboundConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const telegram = raw as Partial<WorkspaceTelegramInboundConfig>
  const normalized: WorkspaceTelegramInboundConfig = {
    ...(typeof telegram.enabled === "boolean" ? { enabled: telegram.enabled } : {}),
    ...(nonEmptyTrimmedString(telegram.botTokenEnv) ? { botTokenEnv: nonEmptyTrimmedString(telegram.botTokenEnv) } : {}),
    ...(nonEmptyTrimmedString(telegram.defaultChatId) ? { defaultChatId: nonEmptyTrimmedString(telegram.defaultChatId) } : {}),
    ...(nonEmptyTrimmedString(telegram.publicBaseUrl) ? { publicBaseUrl: nonEmptyTrimmedString(telegram.publicBaseUrl) } : {}),
  }
  const inbound = normalizeWorkspaceTelegramInbound(telegram.inbound)
  if (inbound) normalized.inbound = inbound
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeDirtyMasterAllowlist(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean)
}

function normalizeOptionalBoolean(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined
}

function isValidHarnessProfile(raw: unknown): raw is HarnessProfile {
  if (!raw || typeof raw !== "object") return false
  const mode = (raw as { mode?: unknown }).mode
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
    case "langdock-gpt5-5-first":
      return true
    case "opencode":
    case "self": {
      const roles = (raw as { roles?: unknown }).roles
      if (!roles || typeof roles !== "object") return false
      const coder = (roles as Record<string, unknown>).coder
      const reviewer = (roles as Record<string, unknown>).reviewer
      return !!coder && typeof coder === "object" && !!reviewer && typeof reviewer === "object"
    }
    default:
      return false
  }
}

export function buildWorkspaceConfigFile(input: {
  key: string
  name: string
  harnessProfile: HarnessProfile
  runtimePolicy?: WorkspaceRuntimePolicy
  dirtyMasterAllowlist?: string[]
  autoRestoreAllowlisted?: boolean
  preview?: WorkspacePreviewConfig
  sonar: SonarConfig
  telegram?: WorkspaceTelegramInboundConfig
  reviewPolicy?: WorkspaceReviewPolicy
  preflight?: WorkspacePreflightReport
  createdAt?: number
}): WorkspaceConfigFile {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    key: input.key,
    name: input.name,
    harnessProfile: input.harnessProfile,
    runtimePolicy: input.runtimePolicy ?? defaultWorkspaceRuntimePolicyForHarnessProfile(input.harnessProfile),
    dirtyMasterAllowlist: input.dirtyMasterAllowlist?.map(value => value.trim()).filter(Boolean),
    autoRestoreAllowlisted: input.autoRestoreAllowlisted,
    preview: input.preview,
    sonar: input.sonar,
    telegram: input.telegram,
    reviewPolicy: input.reviewPolicy ?? normalizeReviewPolicy(undefined, input.sonar, input.key),
    preflight: input.preflight,
    createdAt: input.createdAt ?? Date.now(),
  }
}

function parseWorkspaceConfigFile(raw: {
  schemaVersion?: number
  key?: unknown
  name?: unknown
  harnessProfile?: unknown
  runtimePolicy?: unknown
  dirtyMasterAllowlist?: unknown
  autoRestoreAllowlisted?: unknown
  preview?: unknown
  sonar?: unknown
  telegram?: unknown
  reviewPolicy?: unknown
  preflight?: unknown
  createdAt?: unknown
}): WorkspaceConfigFile | null {
  if ((raw.schemaVersion !== 1 && raw.schemaVersion !== WORKSPACE_SCHEMA_VERSION) || typeof raw.key !== "string" || typeof raw.name !== "string") {
    return null
  }
  if (!isValidHarnessProfile(raw.harnessProfile)) return null
  const runtimePolicy =
    normalizeRuntimePolicy(raw.runtimePolicy) ?? defaultWorkspaceRuntimePolicyForHarnessProfile(raw.harnessProfile)
  const preview = normalizePreviewConfig(raw.preview)
  const sonar = normalizeSonarConfig(
    raw.sonar && typeof raw.sonar === "object" ? (raw.sonar as SonarConfig) : undefined,
    raw.key,
  )
  const reviewPolicy =
    raw.reviewPolicy && typeof raw.reviewPolicy === "object" ? (raw.reviewPolicy as WorkspaceReviewPolicy) : undefined
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    key: raw.key,
    name: raw.name,
    harnessProfile: raw.harnessProfile,
    runtimePolicy,
    dirtyMasterAllowlist: normalizeDirtyMasterAllowlist(raw.dirtyMasterAllowlist),
    autoRestoreAllowlisted: normalizeOptionalBoolean(raw.autoRestoreAllowlisted),
    preview,
    sonar,
    telegram: normalizeWorkspaceTelegramConfig(raw.telegram),
    reviewPolicy: normalizeReviewPolicy(reviewPolicy, sonar, raw.key),
    preflight: raw.preflight && typeof raw.preflight === "object" ? raw.preflight as WorkspacePreflightReport : undefined,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  }
}

export async function readWorkspaceConfig(root: string): Promise<WorkspaceConfigFile | null> {
  try {
    const raw = JSON.parse(await readFile(workspaceConfigPath(root), "utf8")) as Parameters<typeof parseWorkspaceConfigFile>[0]
    return parseWorkspaceConfigFile(raw)
  } catch {
    return null
  }
}

export function readWorkspaceConfigSync(root: string): WorkspaceConfigFile | null {
  try {
    const raw = JSON.parse(readFileSync(workspaceConfigPath(root), "utf8")) as Parameters<typeof parseWorkspaceConfigFile>[0]
    return parseWorkspaceConfigFile(raw)
  } catch {
    return null
  }
}

export async function writeWorkspaceConfig(root: string, config: WorkspaceConfigFile): Promise<void> {
  await mkdir(dirname(workspaceConfigPath(root)), { recursive: true })
  await writeFile(workspaceConfigPath(root), toJson(config), "utf8")
}

export function generateSonarProjectUrl(name: string, sonar: SonarConfig): string | undefined {
  if (!sonar.enabled || !sonar.organization || !sonar.projectKey) return undefined
  const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST
  if (host !== SONAR_DEFAULT_HOST) return undefined
  const params = new URLSearchParams({
    organization: sonar.organization,
    name,
    key: sonar.projectKey,
  })
  return `${SONAR_DEFAULT_HOST}/projects/create?${params.toString()}`
}

export function generateSonarMcpSnippet(sonar: SonarConfig): string | undefined {
  if (!sonar.enabled) return undefined
  const host = sonar.hostUrl ?? SONAR_DEFAULT_HOST
  const args = ["run", "--rm", "-i", "--init", "--pull=always", "-e", "SONARQUBE_TOKEN"]
  const env: string[] = ['"SONARQUBE_TOKEN" = "<YourSonarQubeUserToken>"']
  const isCloudHost = host === SONAR_DEFAULT_HOST || host === "https://sonarqube.us"
  if (isCloudHost) {
    args.push("-e", "SONARQUBE_ORG")
    env.push(`"SONARQUBE_ORG" = "${sonar.organization ?? "<YourOrganizationName>"}"`)
  }
  if (host !== SONAR_DEFAULT_HOST) {
    args.push("-e", "SONARQUBE_URL")
    env.push(`"SONARQUBE_URL" = "${host}"`)
  }
  args.push("mcp/sonarqube")
  return [
    "# See https://docs.sonarsource.com/sonarqube-mcp-server/quickstart-guide/codex-cli",
    "[mcp_servers.sonarqube]",
    'command = "docker"',
    `args = [${args.map(value => JSON.stringify(value)).join(", ")}]`,
    `env = { ${env.join(", ")} }`,
  ].join("\n")
}

export function previewConfigFromDbRow(root: string, harnessProfileJson: string, row: { key: string; name: string; sonar_enabled: number; created_at: number }): WorkspaceConfigFile | null {
  const parsed = safeParseHarnessProfile(harnessProfileJson)
  if (!parsed.profile) return null
  return buildWorkspaceConfigFile({
    key: row.key,
    name: row.name,
    harnessProfile: parsed.profile,
    sonar: { enabled: row.sonar_enabled === 1 },
    createdAt: row.created_at,
  })
}

export { normalizeReviewPolicy, normalizeSonarConfig }
