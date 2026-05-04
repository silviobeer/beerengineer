import { createGitAdapterFromMode } from "../../core/gitAdapter.js"
import type { CapabilityId } from "../../core/capabilities/index.js"
import {
  applyWorkspaceSonarRepair,
  auditWorkspaceSonarCapability,
  enableRegisteredWorkspaceSonarCapability,
  planWorkspaceSonarRepair,
} from "../../core/capabilities/index.js"
import { layout } from "../../core/workspaceLayout.js"
import {
  backfillWorkspaceConfigs,
  getRegisteredWorkspace,
  listRegisteredWorkspaces,
  openWorkspace,
  previewWorkspace,
  promptForWorkspaceAddDefaults,
  registerWorkspace,
  removeWorkspace,
  readWorkspaceConfig,
  runWorkspacePreflight,
} from "../../core/workspaces.js"
import { generateSetupReport } from "../../setup/doctor.js"
import type { AppConfig } from "../../setup/types.js"
import type { RegisterWorkspaceInput } from "../../types/workspace.js"
import { capabilityExitCode } from "../capabilityExitCodes.js"
import type { Command } from "../types.js"
import { renderCapabilityJson, renderCapabilityText, stateNeedsAttention, type CapabilityCliResult } from "./capabilityRenderers.js"
import {
  confirmWorkspacePurge,
  indentBlock,
  loadEffectiveConfig,
  parseHarnessProfile,
  printPreview,
  saveCliState,
  withRepos,
} from "../common.js"

export async function runWorkspacePreviewCommand(path: string | undefined, json = false): Promise<number> {
  const config = loadEffectiveConfig()
  if (!config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }
  if (!path) {
    console.error("  Missing path: beerengineer workspace preview <path>")
    return 2
  }
  return withRepos(async repos => {
    const preview = await previewWorkspace(path, config, repos)
    if (json) process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`)
    else printPreview(preview)
    return preview.conflicts.length > 0 ? 1 : 0
  })
}

export async function runWorkspaceAddCommand(cmd: Extract<Command, { kind: "workspace-add" }>): Promise<number> {
  const config = loadEffectiveConfig()
  if (!config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }

  try {
    const addInput = await resolveWorkspaceAddInput(cmd, config)
    if (typeof addInput === "number") return addInput
    return await executeWorkspaceAdd(cmd, config, addInput)
  } catch (err) {
    console.error(`  ${(err as Error).message}`)
    return 2
  }
}

async function resolveWorkspaceAddInput(
  cmd: Extract<Command, { kind: "workspace-add" }>,
  config: AppConfig,
): Promise<RegisterWorkspaceInput | number> {
  if (!cmd.path && !cmd.noInteractive && process.stdin.isTTY && process.stdout.isTTY) {
    const prompted = await promptForWorkspaceAddDefaults(config)
    return {
      path: prompted.path,
      name: prompted.name,
      key: prompted.key,
      harnessProfile: prompted.profile,
      sonar: prompted.sonar,
      git: { init: prompted.gitInit, defaultBranch: "main" },
      github: prompted.github,
      sonarToken: prompted.sonarToken,
    }
  }
  if (!cmd.path) {
    console.error("  Missing --path for non-interactive workspace add.")
    return 2
  }
  return {
    path: cmd.path,
    name: cmd.name,
    key: cmd.key,
    harnessProfile: parseHarnessProfile(cmd, config),
    sonar: cmd.sonar
      ? {
          enabled: true,
          projectKey: cmd.sonarKey,
          organization: cmd.sonarOrg,
          hostUrl: cmd.sonarHost,
        }
      : { enabled: false },
    git: { init: cmd.noGit !== true, defaultBranch: "main" },
    github: cmd.ghCreate
      ? { create: true, visibility: cmd.ghPublic ? "public" : "private", owner: cmd.ghOwner }
      : undefined,
    sonarToken: cmd.sonarToken
      ? { value: cmd.sonarToken, persist: cmd.sonarTokenPersist !== false }
      : undefined,
  }
}

async function executeWorkspaceAdd(
  cmd: Extract<Command, { kind: "workspace-add" }>,
  config: AppConfig,
  addInput: RegisterWorkspaceInput,
): Promise<number> {
  return withRepos(async repos => {
    const appReport = await generateSetupReport({ allLlmGroups: true })
    const result = await registerWorkspace(addInput, { repos, config, appReport })
    if (cmd.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return result.ok ? 0 : 1
    }
    if (!result.ok) {
      console.error(`  ${result.error}: ${result.detail}`)
      return 1
    }
    printWorkspaceAddResult(result)
    return 0
  })
}

function printWorkspaceAddResult(result: Awaited<ReturnType<typeof registerWorkspace>> & { ok: true }): void {
  for (const action of result.actions) console.log(`  ${action}`)
  for (const warning of result.warnings) console.log(`  ! ${warning}`)
  console.log(`\n  Registered as "${result.workspace.name}" (key: ${result.workspace.key}).`)
  printWorkspaceAddNextSteps(result)
  if (result.workspace.sonarEnabled) printWorkspaceSonarReadiness(result)
  if (result.sonarProjectUrl || result.ghCreateCommand) printWorkspaceCodeRabbitHints(result.ghCreateCommand)
  console.log(`    Open: beerengineer workspace open ${result.workspace.key}`)
}

function printWorkspaceAddNextSteps(result: {
  sonarProjectUrl?: string
  sonarMcpSnippet?: string
  ghCreateCommand?: string
}): void {
  if (result.sonarProjectUrl) {
    console.log("\n  Next steps")
    console.log("    SonarQube Cloud")
    console.log(`    1. Create or import the project in SonarQube Cloud: ${result.sonarProjectUrl}`)
    console.log("    2. Check whether your org uses the EU default or the US region.")
    console.log("    3. Create an analysis token and export it locally: export SONAR_TOKEN=...")
    console.log("       Prefer repo-local git config for workspace sharing across worktrees; never commit it to the repo.")
    console.log("    4. Mark the project as AI-generated: Project settings > AI-generated code >")
    console.log("       enable \"Contains AI-generated code\" (adds the +Contains AI code label).")
    console.log("    5. Apply an AI-qualified quality gate: Project settings > Quality Gate >")
    console.log("       select \"Sonar way for AI Code\" (or a custom gate qualified for AI Code")
    console.log("       Assurance by a Quality Standard admin).")
    console.log("    6. Disable automatic analysis: Administration > Analysis Method > uncheck")
    console.log("       \"Enabled for this project\" so only the local sonar-scanner runs.")
    console.log("    7. Keep durable analysis settings in the SonarQube Cloud UI when possible.")
    console.log("    8. If the project is on the US region, set sonar.region=us for scanner runs.")
    if (result.sonarMcpSnippet) {
      console.log("    9. Optional: add Sonar MCP to your Codex config (~/.codex/config.toml):")
      console.log(`\n${indentBlock(result.sonarMcpSnippet, 6)}`)
    }
    return
  }
  if (result.ghCreateCommand) console.log("\n  Next steps")
}

function printWorkspaceSonarReadiness(result: {
  sonarReadiness: {
    scanner: string
    token: string
    config: string
    coverage: string
    details?: { token?: string; config?: string; coverage?: string }
  }
}): void {
  const tokenDetail = result.sonarReadiness.details?.token
  const configDetail = result.sonarReadiness.details?.config
  const coverageDetail = result.sonarReadiness.details?.coverage
  console.log("    Local Sonar readiness")
  console.log(`    - scanner: ${result.sonarReadiness.scanner}`)
  const tokenSuffix = tokenDetail ? ` (${tokenDetail})` : ""
  const configSuffix = configDetail ? ` (${configDetail})` : ""
  const coverageSuffix = coverageDetail ? ` (${coverageDetail})` : ""
  console.log(`    - token: ${result.sonarReadiness.token}${tokenSuffix}`)
  console.log(`    - config: ${result.sonarReadiness.config}${configSuffix}`)
  console.log(`    - coverage: ${result.sonarReadiness.coverage}${coverageSuffix}`)
}

function printWorkspaceCodeRabbitHints(ghCreateCommand?: string): void {
  console.log("    CodeRabbit")
  console.log("    - Optional: install the CLI with npm i -g @coderabbit/cli")
  console.log("    - Authenticate it per the CodeRabbit CLI docs before enabling real review runs")
  console.log("    - If it is not configured, beerengineer_ will skip CodeRabbit review for the workspace")
  if (ghCreateCommand) console.log(`    Optional remote: ${ghCreateCommand}`)
}

export async function runWorkspaceListCommand(json = false): Promise<number> {
  return withRepos(async repos => {
    const rows = listRegisteredWorkspaces(repos)
    if (json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
      return 0
    }
    if (rows.length === 0) {
      console.log("  No workspaces registered.")
      return 0
    }
    for (const row of rows) console.log(`  ${row.key}  ${row.rootPath}`)
    return 0
  })
}

export async function runWorkspaceGetCommand(key: string | undefined, json = false): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace get <key>")
    return 2
  }
  return withRepos(async repos => {
    const workspace = getRegisteredWorkspace(repos, key)
    if (!workspace) return 1
    if (json) process.stdout.write(`${JSON.stringify(workspace, null, 2)}\n`)
    else console.log(`  ${workspace.key}  ${workspace.rootPath}`)
    return 0
  })
}

export async function runWorkspaceRemoveCommand(
  key: string | undefined,
  purge = false,
  json = false,
  yes = false,
  noInteractive = false,
): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace remove <key>")
    return 2
  }
  const config = purge ? loadEffectiveConfig() : null
  if (purge && !config) {
    console.error("  App config is missing or invalid. Run `beerengineer setup` first.")
    return 1
  }
  return withRepos(async repos => {
    const confirmationStatus = await confirmWorkspacePurge({ repos, key, purge, yes, noInteractive, json })
    if (confirmationStatus !== null) return confirmationStatus
    const result = await removeWorkspace(repos, key, {
      purge,
      allowedRoots: config?.allowedRoots,
    })
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return result.ok ? 0 : 1
    }
    if (!result.ok) return 1
    if (result.purgeSkipped) {
      console.log(`  Removed workspace ${key} (purge skipped: ${result.purgeSkipped.reason} for ${result.purgeSkipped.path})`)
    } else {
      const purgeSuffix = purge && result.purgedPath ? ` and purged ${result.purgedPath}` : ""
      console.log(`  Removed workspace ${key}${purgeSuffix}`)
    }
    return 0
  })
}

export async function runWorkspaceOpenCommand(key: string | undefined): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace open <key>")
    return 2
  }
  return withRepos(async repos => {
    const rootPath = openWorkspace(repos, key)
    if (!rootPath) return 1
    process.stdout.write(`${rootPath}\n`)
    return 0
  })
}

export async function runWorkspaceUseCommand(key: string | undefined): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace use <key>")
    return 2
  }
  return withRepos(async repos => {
    const workspace = repos.getWorkspaceByKey(key)
    if (!workspace) {
      console.error(`  Workspace not found: ${key}`)
      return 1
    }
    repos.touchWorkspaceLastOpenedAt(key)
    saveCliState({ currentWorkspaceKey: key })
    console.log(`  Current workspace: ${key}`)
    return 0
  })
}

export async function runWorkspaceBackfillCommand(json = false): Promise<number> {
  return withRepos(async repos => {
    const result = await backfillWorkspaceConfigs(repos)
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }
    for (const key of result.written) console.log(`  wrote config for ${key}`)
    for (const skipped of result.skipped) console.log(`  skipped ${skipped.key}: ${skipped.reason}`)
    return 0
  })
}

export async function runWorkspaceWorktreeGcCommand(key: string | undefined, json = false): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace gc-worktrees <key>")
    return 2
  }

  return withRepos(async repos => {
    const workspace = getRegisteredWorkspace(repos, key)
    const rootPath = workspace?.rootPath?.trim()
    if (!rootPath) {
      console.error(`  Workspace not found or has no root path: ${key}`)
      return 1
    }

    const gcContext = {
      workspaceId: "gc",
      runId: "gc",
      itemSlug: "gc",
      baseBranch: "main",
      workspaceRoot: rootPath,
    }
    const git = createGitAdapterFromMode(gcContext, {
      enabled: true,
      workspaceRoot: rootPath,
      baseBranch: "main",
      itemWorktreeRoot: rootPath,
    })
    const result = git.gcManagedStoryWorktrees(layout.worktreesRoot(rootPath))

    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      console.log(`  Removed worktrees: ${result.removed.length}`)
      result.removed.forEach(path => console.log(`    removed ${path}`))
      console.log(`  Kept worktrees: ${result.kept.length}`)
      result.kept.forEach(entry => console.log(`    kept ${entry.path} (${entry.reason})`))
    }
    return 0
  })
}

async function loadRegisteredWorkspaceConfig(repos: Parameters<typeof getRegisteredWorkspace>[0], key: string | undefined) {
  if (!key) return { ok: false as const, status: capabilityExitCode("usage"), message: "Missing workspace key for capability command" }
  const workspace = getRegisteredWorkspace(repos, key)
  if (!workspace?.rootPath) return { ok: false as const, status: capabilityExitCode("usage"), message: `Workspace not found: ${key}` }
  const config = await readWorkspaceConfig(workspace.rootPath)
  if (!config) return { ok: false as const, status: capabilityExitCode("usage"), message: `.beerengineer/workspace.json is missing or invalid for ${key}` }
  return { ok: true as const, workspace, config }
}

function capabilityResultFromPreflight(rootPath: string, capabilityId: CapabilityId, preflight: Awaited<ReturnType<typeof runWorkspacePreflight>>["report"]): CapabilityCliResult {
  const capability = preflight.capabilities.find(item => item.capabilityId === capabilityId)
  if (!capability) {
    return {
      capabilityId,
      status: "failed",
      summary: `${capabilityId} failed readiness checks`,
      reason: "Capability was not present in workspace preflight output",
      details: { rootPath },
    }
  }
  return {
    capabilityId,
    status: capability.status,
    summary: capability.summary,
    reason: capability.reason,
    nextActions: capability.status === "ready" ? [] : [`Run workspace ${capabilityId} status after fixing the reported issue`],
    details: { rootPath, preflight: preflight[capabilityId === "github" ? "github" : capabilityId] },
  }
}

async function runWorkspaceCapabilityStatusCommand(
  key: string | undefined,
  capabilityId: Extract<CapabilityId, "git" | "github" | "coderabbit">,
  json = false,
): Promise<number> {
  return withRepos(async repos => {
    const loaded = await loadRegisteredWorkspaceConfig(repos, key)
    if (!loaded.ok) {
      console.error(`  ${loaded.message}`)
      return loaded.status
    }
    const preflight = await runWorkspacePreflight(loaded.workspace.rootPath, {
      sonarHostUrl: loaded.config.sonar.hostUrl,
      sonarEnabled: loaded.config.sonar.enabled,
    })
    const result = capabilityResultFromPreflight(loaded.workspace.rootPath, capabilityId, preflight.report)
    process.stdout.write(json ? renderCapabilityJson(result) : renderCapabilityText(result))
    if (!stateNeedsAttention(result)) return capabilityExitCode("success")
    return capabilityId === "git" ? capabilityExitCode("requiredFailure") : capabilityExitCode("optionalWarning")
  })
}

export async function runWorkspaceGitStatusCommand(key: string | undefined, json = false): Promise<number> {
  return runWorkspaceCapabilityStatusCommand(key, "git", json)
}

export async function runWorkspaceGithubStatusCommand(key: string | undefined, json = false): Promise<number> {
  return runWorkspaceCapabilityStatusCommand(key, "github", json)
}

export async function runWorkspaceCodeRabbitStatusCommand(key: string | undefined, json = false): Promise<number> {
  return runWorkspaceCapabilityStatusCommand(key, "coderabbit", json)
}

export async function runWorkspaceSonarEnableCommand(key: string | undefined, json = false): Promise<number> {
  if (!key) {
    console.error("  Missing key: beerengineer workspace sonar enable <key>")
    return capabilityExitCode("usage")
  }
  return withRepos(async repos => {
    const result = await enableRegisteredWorkspaceSonarCapability(repos, key)
    if (json) {
      process.stdout.write(renderCapabilityJson({
        capabilityId: "sonar",
        status: result.capability.status,
        summary: result.capability.summary,
        reason: result.capability.reason,
        nextActions: result.nextActions,
        details: result,
      }))
      return result.ok ? capabilityExitCode("success") : capabilityExitCode("optionalWarning")
    }
    for (const action of result.actions) console.log(`  ${action}`)
    for (const warning of result.warnings) console.log(`  ! ${warning}`)
    if (!result.ok) {
      console.error(`  Sonar enable incomplete: ${result.capability.reason ?? result.capability.summary}`)
      for (const action of result.nextActions) console.error(`  next: ${action}`)
      return capabilityExitCode("optionalWarning")
    }
    console.log(`  Sonar enabled for ${key}`)
    return capabilityExitCode("success")
  })
}

export async function runWorkspaceSonarAuditCommand(key: string | undefined, json = false): Promise<number> {
  return withRepos(async repos => {
    const loaded = await loadRegisteredWorkspaceConfig(repos, key)
    if (!loaded.ok) {
      console.error(`  ${loaded.message}`)
      return loaded.status
    }
    const report = await auditWorkspaceSonarCapability(loaded.workspace.rootPath, loaded.config)
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return report.status === "ready" ? capabilityExitCode("success") : capabilityExitCode("optionalWarning")
    }
    console.log(`  Sonar audit for ${loaded.workspace.key}: ${report.status}`)
    console.log(`  sources: ${report.sourceRoots.join(", ") || "(none)"}`)
    console.log(`  tests: ${report.testRoots.join(", ") || "(none)"}`)
    console.log(`  coverage: ${report.coverageReports.join(", ") || "(none)"}`)
    for (const finding of report.findings) console.log(`  ! ${finding.id}: ${finding.message} (${finding.risk}, ${finding.repairability})`)
    return report.status === "ready" ? capabilityExitCode("success") : capabilityExitCode("optionalWarning")
  })
}

export async function runWorkspaceSonarRepairCommand(key: string | undefined, apply = false, json = false): Promise<number> {
  return withRepos(async repos => {
    const loaded = await loadRegisteredWorkspaceConfig(repos, key)
    if (!loaded.ok) {
      console.error(`  ${loaded.message}`)
      return loaded.status
    }
    const report = apply
      ? await applyWorkspaceSonarRepair(loaded.workspace.rootPath, loaded.config)
      : await planWorkspaceSonarRepair(loaded.workspace.rootPath, loaded.config)
    if (apply && report.actions.some(action => action.id === "sonar-disabled" && action.applied)) {
      const updatedConfig = await readWorkspaceConfig(loaded.workspace.rootPath)
      const currentRow = repos.getWorkspaceByKey(loaded.workspace.key)
      if (updatedConfig) {
        repos.upsertWorkspace({
          key: updatedConfig.key,
          name: updatedConfig.name,
          description: currentRow?.description ?? null,
          rootPath: loaded.workspace.rootPath,
          harnessProfileJson: JSON.stringify(updatedConfig.harnessProfile),
          sonarEnabled: updatedConfig.sonar.enabled,
        })
      }
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return apply || report.actions.length === 0 ? capabilityExitCode("success") : capabilityExitCode("optionalWarning")
    }
    console.log(`  Sonar repair ${report.mode} for ${loaded.workspace.key}: ${report.status}`)
    for (const action of report.actions) {
      const suffix = action.applied ? "applied" : action.reason ?? "planned"
      console.log(`  - ${action.id}: ${action.description} (${action.repairability}, ${suffix})`)
    }
    return apply || report.actions.length === 0 ? capabilityExitCode("success") : capabilityExitCode("optionalWarning")
  })
}
