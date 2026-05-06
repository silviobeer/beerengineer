import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import type { Repos } from "../../db/repositories.js"
import { DEFAULT_SONAR_READINESS } from "../../setup/types.js"
import type { SonarReadiness } from "../../setup/types.js"
import type { SonarConfig, WorkspaceCapabilityResult, WorkspaceConfigFile, WorkspacePreflightReport } from "../../types/workspace.js"
import {
  SONAR_PROPERTIES_FILE,
  SONAR_WORKFLOW_FILE,
  WORKSPACE_CONFIG_DIR,
  WORKSPACE_CONFIG_FILE,
  renderSonarWorkflow,
  pathExists,
  sonarPropertiesPath,
  sonarWorkflowPath,
  writeFileIfMissing,
} from "../workspaces/shared.js"
import {
  buildGeneratedSonarProperties,
  detectSonarSourceRoots,
  loadWorkspaceSonarProperties,
  provisionSonarProject,
  runWorkspacePreflight,
  writeSonarProperties,
} from "../workspaces/sonar.js"
import {
  buildWorkspaceConfigFile,
  normalizeReviewPolicy,
  normalizeSonarConfig,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from "../workspaces/configFile.js"
import { buildWorkspaceCapabilityContext } from "./workspaceContext.js"
import type { WorkspaceCapabilityContext } from "./workspaceContext.js"

export type SonarLifecycleStatus = "ready" | "failed" | "not_configured"
export type SonarFindingRisk = "low" | "medium" | "high"
export type SonarRepairability = "safe" | "risky" | "ambiguous"

export type SonarAuditFinding = {
  id: string
  message: string
  risk: SonarFindingRisk
  repairability: SonarRepairability
}

export type SonarRepairAction = {
  id: string
  description: string
  repairability: SonarRepairability
  applied: boolean
  reason?: string
}

export type SonarAuditReport = {
  capabilityId: "sonar"
  workspaceKey: string
  workspaceRoot: string
  status: SonarLifecycleStatus
  sourceRoots: string[]
  testRoots: string[]
  coverageReports: string[]
  readiness: SonarReadiness
  findings: SonarAuditFinding[]
  checkedAt: string
}

export type SonarRepairReport = {
  capabilityId: "sonar"
  workspaceKey: string
  workspaceRoot: string
  mode: "dry-run" | "apply"
  status: SonarLifecycleStatus
  actions: SonarRepairAction[]
  findings: SonarAuditFinding[]
  checkedAt: string
}

export type SonarEnableResult = {
  ok: boolean
  capability: WorkspaceCapabilityResult
  actions: string[]
  warnings: string[]
  nextActions: string[]
  preflight: Awaited<ReturnType<typeof runWorkspacePreflight>>["report"]
}

function sonarConfigForContext(
  sonar: SonarConfig,
  context: WorkspaceCapabilityContext,
  options: { defaultSonarOrganization?: string } = {},
): SonarConfig {
  if (!sonar.enabled) return { enabled: false }
  return normalizeSonarConfig({
    ...sonar,
    organization: sonar.organization ?? context.github.owner,
    projectKey: sonar.projectKey ?? (context.github.owner && context.github.repo ? `${context.github.owner}_${context.github.repo}` : undefined),
    baseBranch: sonar.baseBranch ?? context.github.defaultBranch ?? undefined,
  }, context.github.repo ?? "workspace", options.defaultSonarOrganization)
}

function missingPrerequisites(context: WorkspaceCapabilityContext, sonar: SonarConfig): string[] {
  const missing: string[] = []
  if (!sonar.enabled) missing.push("Sonar is disabled for this workspace")
  if (!context.git.ready) missing.push("Git repository is not ready")
  if ((!sonar.organization || !sonar.projectKey) && (!context.github.owner || !context.github.repo)) {
    missing.push("GitHub origin remote is not configured")
  }
  return missing
}

function capabilityFromPreflight(preflight: Awaited<ReturnType<typeof runWorkspacePreflight>>["report"]): WorkspaceCapabilityResult {
  return preflight.capabilities.find(capability => capability.capabilityId === "sonar")
    ?? { capabilityId: "sonar", status: "failed", summary: "sonar failed readiness checks", reason: "Sonar preflight did not report a capability outcome" }
}

export async function enableWorkspaceSonarCapability(
  context: WorkspaceCapabilityContext,
  name: string,
  sonar: SonarConfig,
  options: { defaultSonarOrganization?: string } = {},
): Promise<SonarEnableResult> {
  const actions: string[] = []
  const warnings: string[] = []
  const configuredSonar = sonarConfigForContext(sonar, context, options)
  const missing = missingPrerequisites(context, configuredSonar)
  if (missing.length > 0) {
    const preflight = await runWorkspacePreflight(context.workspaceRoot, {
      sonarHostUrl: configuredSonar.hostUrl,
      sonarEnabled: configuredSonar.enabled,
    })
    return {
      ok: false,
      capability: capabilityFromPreflight(preflight.report),
      actions,
      warnings,
      nextActions: missing,
      preflight: preflight.report,
    }
  }

  const sonarWrite = await writeSonarProperties(context.workspaceRoot, {
    organization: configuredSonar.organization!,
    projectKey: configuredSonar.projectKey!,
  })
  if (sonarWrite.changed) actions.push(`wrote ${SONAR_PROPERTIES_FILE}`)
  warnings.push(...sonarWrite.warnings)
  if (await writeFileIfMissing(resolve(context.workspaceRoot, SONAR_WORKFLOW_FILE), renderSonarWorkflow())) {
    actions.push(`wrote ${SONAR_WORKFLOW_FILE}`)
  }
  const refreshedPreflight = await runWorkspacePreflight(context.workspaceRoot, {
    sonarHostUrl: configuredSonar.hostUrl,
    sonarEnabled: configuredSonar.enabled,
  })
  if (configuredSonar.enabled && refreshedPreflight.report.sonar.status === "ok") {
    await provisionSonarProject(context.workspaceRoot, name, configuredSonar, actions, warnings)
  }
  return {
    ok: refreshedPreflight.report.sonar.status === "ok",
    capability: capabilityFromPreflight(refreshedPreflight.report),
    actions,
    warnings,
    nextActions: refreshedPreflight.report.sonar.status === "ok" ? [] : [refreshedPreflight.report.sonar.detail ?? "Complete Sonar readiness prerequisites"],
    preflight: refreshedPreflight.report,
  }
}

export async function provisionWorkspaceSonarCapability(
  context: WorkspaceCapabilityContext,
  name: string,
  sonar: SonarConfig,
  actions: string[],
  warnings: string[],
) {
  const result = await enableWorkspaceSonarCapability(context, name, sonar)
  actions.push(...result.actions)
  warnings.push(...result.warnings)
  return { report: result.preflight }
}

function splitConfigList(value: string | undefined): string[] {
  return (value ?? "").split(",").map(entry => entry.trim()).filter(Boolean)
}

function statusFromFindings(findings: SonarAuditFinding[]): SonarLifecycleStatus {
  if (findings.some(finding => finding.risk === "high")) return "failed"
  if (findings.length > 0) return "not_configured"
  return "ready"
}

function currentSonarConfig(config: WorkspaceConfigFile): SonarConfig {
  return normalizeSonarConfig(config.reviewPolicy?.sonarcloud ?? config.sonar, config.key)
}

async function readSonarPropertiesRaw(root: string): Promise<string | null> {
  try {
    return await readFile(sonarPropertiesPath(root), "utf8")
  } catch {
    return null
  }
}

export async function auditWorkspaceSonarCapability(root: string, config: WorkspaceConfigFile): Promise<SonarAuditReport> {
  const sonar = currentSonarConfig(config)
  const preflight = await runWorkspacePreflight(root, { sonarHostUrl: sonar.hostUrl, sonarEnabled: sonar.enabled })
  const props = await loadWorkspaceSonarProperties(root)
  const readiness: SonarReadiness = preflight.report.sonar.readiness ?? DEFAULT_SONAR_READINESS
  const sourceRoots = props ? splitConfigList(props["sonar.sources"]) : await detectSonarSourceRoots(root)
  const testRoots = props ? splitConfigList(props["sonar.tests"]) : []
  const coverageReports = props ? splitConfigList(props["sonar.javascript.lcov.reportPaths"]) : []
  const findings: SonarAuditFinding[] = []
  if (!sonar.enabled) {
    findings.push({ id: "sonar-disabled", message: "Workspace metadata has Sonar disabled", risk: "medium", repairability: "safe" })
  }
  if (!props) {
    findings.push({ id: "sonar-properties-missing", message: `${SONAR_PROPERTIES_FILE} is missing`, risk: "high", repairability: "safe" })
  } else if (readiness.config === "invalid") {
    findings.push({ id: "sonar-properties-invalid", message: readiness.details?.config ?? `${SONAR_PROPERTIES_FILE} is invalid`, risk: "high", repairability: "risky" })
  }
  if (!(await pathExists(sonarWorkflowPath(root)))) {
    findings.push({ id: "sonar-workflow-missing", message: `${SONAR_WORKFLOW_FILE} is missing`, risk: "medium", repairability: "safe" })
  }
  if (coverageReports.length === 0) {
    findings.push({ id: "coverage-not-configured", message: readiness.details?.coverage ?? "LCOV coverage import is not configured", risk: "low", repairability: "ambiguous" })
  }
  return {
    capabilityId: "sonar",
    workspaceKey: config.key,
    workspaceRoot: root,
    status: statusFromFindings(findings),
    sourceRoots,
    testRoots,
    coverageReports,
    readiness,
    findings,
    checkedAt: new Date().toISOString(),
  }
}

async function buildSafeRepairActions(root: string, config: WorkspaceConfigFile, audit: SonarAuditReport): Promise<SonarRepairAction[]> {
  const sonar = currentSonarConfig(config)
  const actions: SonarRepairAction[] = []
  for (const finding of audit.findings) {
    if (finding.repairability !== "safe") {
      actions.push({ id: finding.id, description: finding.message, repairability: finding.repairability, applied: false, reason: "Manual confirmation is required" })
      continue
    }
    actions.push({ id: finding.id, description: finding.message, repairability: "safe", applied: false })
  }
  if (audit.findings.length === 0) {
    const raw = await readSonarPropertiesRaw(root)
    const generated = sonar.organization && sonar.projectKey
      ? await buildGeneratedSonarProperties(root, { organization: sonar.organization, projectKey: sonar.projectKey })
      : { warnings: [] }
    if (raw && generated.content && raw !== generated.content) {
      actions.push({
        id: "sonar-properties-drift",
        description: `${SONAR_PROPERTIES_FILE} differs from generated defaults`,
        repairability: "risky",
        applied: false,
        reason: "Existing config may contain intentional custom settings",
      })
    }
  }
  return actions
}

export async function planWorkspaceSonarRepair(root: string, config: WorkspaceConfigFile): Promise<SonarRepairReport> {
  const audit = await auditWorkspaceSonarCapability(root, config)
  return {
    capabilityId: "sonar",
    workspaceKey: config.key,
    workspaceRoot: root,
    mode: "dry-run",
    status: audit.status,
    actions: await buildSafeRepairActions(root, config, audit),
    findings: audit.findings,
    checkedAt: new Date().toISOString(),
  }
}

export async function applyWorkspaceSonarRepair(root: string, config: WorkspaceConfigFile): Promise<SonarRepairReport> {
  const planned = await planWorkspaceSonarRepair(root, config)
  const sonar = currentSonarConfig(config)
  for (const action of planned.actions.filter(action => action.repairability === "safe")) {
    if (action.id === "sonar-properties-missing" && sonar.organization && sonar.projectKey) {
      const written = await writeSonarProperties(root, { organization: sonar.organization, projectKey: sonar.projectKey })
      action.applied = written.changed
      if (!written.changed) action.reason = "Already up to date"
    } else if (action.id === "sonar-workflow-missing") {
      action.applied = await writeFileIfMissing(sonarWorkflowPath(root), renderSonarWorkflow())
      if (!action.applied) action.reason = "Already up to date"
    } else if (action.id === "sonar-disabled") {
      const updatedSonar = { ...sonar, enabled: true }
      await writeWorkspaceConfig(root, buildWorkspaceConfigFile({
        key: config.key,
        name: config.name,
        harnessProfile: config.harnessProfile,
        runtimePolicy: config.runtimePolicy,
        preview: config.preview,
        sonar: updatedSonar,
        reviewPolicy: normalizeReviewPolicy(config.reviewPolicy, updatedSonar, config.key),
        preflight: config.preflight,
        createdAt: config.createdAt,
      }))
      action.applied = true
    } else {
      action.applied = false
      action.reason = `No automatic repair handler is available for ${action.id}`
    }
  }
  const refreshedConfig = await readWorkspaceConfig(root) ?? config
  return { ...planned, mode: "apply", status: (await auditWorkspaceSonarCapability(root, refreshedConfig)).status }
}

function missingWorkspacePreflight(key: string): WorkspacePreflightReport {
  const reason = `Workspace not found: ${key}`
  return {
    git: { status: "skipped", detail: reason, defaultBranch: null },
    github: { status: "skipped", detail: reason, defaultBranch: null },
    gh: { status: "skipped", detail: reason },
    sonar: { status: "skipped", detail: reason, readiness: DEFAULT_SONAR_READINESS },
    coderabbit: { status: "skipped", detail: reason },
    capabilities: [
      { capabilityId: "sonar", status: "failed", summary: "sonar failed readiness checks", reason },
    ],
    checkedAt: new Date().toISOString(),
  }
}

export async function enableRegisteredWorkspaceSonarCapability(
  repos: Repos,
  key: string,
  options: { defaultSonarOrganization?: string } = {},
): Promise<SonarEnableResult & { workspaceRoot?: string }> {
  const row = repos.getWorkspaceByKey(key)
  if (!row?.root_path) {
    return {
      ok: false,
      capability: { capabilityId: "sonar", status: "failed", summary: "sonar failed readiness checks", reason: `Workspace not found: ${key}` },
      actions: [],
      warnings: [],
      nextActions: [`Register workspace ${key} first`],
      preflight: missingWorkspacePreflight(key),
    }
  }
  const config = await readWorkspaceConfig(row.root_path)
  if (!config) {
    return {
      ok: false,
      workspaceRoot: row.root_path,
      capability: { capabilityId: "sonar", status: "failed", summary: "sonar failed readiness checks", reason: `${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE} is missing or invalid` },
      actions: [],
      warnings: [],
      nextActions: [`Restore ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE}`],
      preflight: (await runWorkspacePreflight(row.root_path, { sonarEnabled: true })).report,
    }
  }
  const preflight = await runWorkspacePreflight(row.root_path, { sonarHostUrl: config.sonar.hostUrl, sonarEnabled: true })
  const context = buildWorkspaceCapabilityContext(row.root_path, preflight.report, { githubRequired: true })
  const sonar = sonarConfigForContext(
    normalizeSonarConfig({ ...config.sonar, enabled: true }, config.key, options.defaultSonarOrganization),
    context,
    options,
  )
  const result = await enableWorkspaceSonarCapability(context, config.name, sonar, options)
  const resolvedSonar = { ...sonar, enabled: result.ok || result.actions.length > 0 }
  const resolvedReviewPolicy = normalizeReviewPolicy(config.reviewPolicy, resolvedSonar, config.key)
  const metadataChanged =
    JSON.stringify(config.sonar) !== JSON.stringify(resolvedSonar) ||
    JSON.stringify(config.reviewPolicy) !== JSON.stringify(resolvedReviewPolicy)
  if (result.actions.length > 0 || config.sonar.enabled !== true || metadataChanged) {
    const updatedConfig = buildWorkspaceConfigFile({
      key: config.key,
      name: config.name,
      harnessProfile: config.harnessProfile,
      runtimePolicy: config.runtimePolicy,
      preview: config.preview,
      sonar: resolvedSonar,
      reviewPolicy: resolvedReviewPolicy,
      preflight: result.preflight,
      createdAt: config.createdAt,
    })
    await writeWorkspaceConfig(row.root_path, updatedConfig)
    repos.upsertWorkspace({
      key: config.key,
      name: config.name,
      rootPath: row.root_path,
      harnessProfileJson: JSON.stringify(config.harnessProfile),
      sonarEnabled: updatedConfig.sonar.enabled,
      description: row.description,
    })
    result.actions.push(`wrote ${WORKSPACE_CONFIG_DIR}/${WORKSPACE_CONFIG_FILE}`)
  }
  return { ...result, workspaceRoot: row.root_path }
}
