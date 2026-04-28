import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"
import type { Finding } from "../types.js"
import { commandExists, runCommand } from "./commandRunner.js"
import { reviewCycleArtifactsDir, writeArtifactJson, writeArtifactText } from "./artifacts.js"
import type { GateCondition, ReviewScope, SonarCloudResult } from "./types.js"

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const branchLocks = new Map<string, Promise<void>>()
const execFileAsync = promisify(execFile)

function basicAuthHeader(token: string): string {
  const credentials = `${token}:`
  return `Basic ${Buffer.from(credentials).toString("base64")}`
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: basicAuthHeader(token),
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  return response.json()
}

async function withBranchLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = branchLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolveLock => {
    release = resolveLock
  })
  const chained = previous.then(() => current)
  branchLocks.set(key, chained)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (branchLocks.get(key) === chained) branchLocks.delete(key)
  }
}

function readTokenFromEnvFile(raw: string): string | undefined {
  for (const line of raw.split(/\r?\n/)) {
    const match = /^SONAR_TOKEN=(.*)$/.exec(line.trim())
    if (match?.[1]) return match[1].replaceAll(/^["']|["']$/g, "")
  }
  return undefined
}

async function readTokenFromFile(path: string): Promise<string | undefined> {
  try {
    return readTokenFromEnvFile(await readFile(path, "utf8"))
  } catch {
    return undefined
  }
}

async function readGitConfigToken(workspaceRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", "beerengineer.sonarToken"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    })
    const value = stdout.trim()
    return value || undefined
  } catch {
    return undefined
  }
}

async function readLocalEnvToken(workspaceRoot: string): Promise<string | undefined> {
  return await readTokenFromFile(resolve(workspaceRoot, ".env.local"))
    ?? await readTokenFromFile(resolve(workspaceRoot, ".env"))
    ?? await readGitConfigToken(workspaceRoot)
}

function mapSeverity(severity: string | undefined): Finding<"sonarqube">["severity"] {
  switch (severity?.toUpperCase()) {
    case "BLOCKER":
      return "critical"
    case "CRITICAL":
    case "HIGH":
      return "high"
    case "MAJOR":
    case "MEDIUM":
      return "medium"
    default:
      return "low"
  }
}

function mapIssueFinding(issue: Record<string, unknown>): Finding<"sonarqube"> {
  const rule = typeof issue.rule === "string" ? issue.rule : "sonarqube"
  const message = typeof issue.message === "string" ? issue.message : "SonarQube reported an issue."
  return {
    source: "sonarqube",
    severity: mapSeverity(typeof issue.severity === "string" ? issue.severity : undefined),
    message: `${rule}: ${message}`,
  }
}

function mapConditions(input: unknown): GateCondition[] {
  if (!Array.isArray(input)) return []
  return input.flatMap(condition => {
    if (!condition || typeof condition !== "object") return []
    const item = condition as Record<string, unknown>
    return [{
      metric: typeof item.metricKey === "string" ? item.metricKey : "unknown",
      status: item.status === "ERROR" ? "error" : "ok",
      actual: typeof item.actualValue === "string" ? item.actualValue : "",
      threshold: typeof item.errorThreshold === "string" ? item.errorThreshold : "",
    }]
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCeTask(
  ceTaskUrl: string,
  token: string,
  timeoutMs: number,
): Promise<{ analysisId?: string; failureReason?: string }> {
  const startedAt = Date.now()
  let delayMs = 2_000
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await fetchJson(ceTaskUrl, token) as {
      task?: { status?: string; analysisId?: string; errorMessage?: string }
    }
    const status = payload.task?.status
    if (status === "SUCCESS") return { analysisId: payload.task?.analysisId }
    if (status === "FAILED" || status === "CANCELED") {
      return { failureReason: payload.task?.errorMessage ?? `ce-task-${status.toLowerCase()}` }
    }
    await sleep(delayMs)
    delayMs = Math.min(delayMs * 2, 15_000)
  }
  return { failureReason: "ce-task-timeout" }
}

async function findReportTask(workspaceRoot: string): Promise<Record<string, string> | null> {
  const candidates = [
    resolve(workspaceRoot, ".scannerwork", "report-task.txt"),
    resolve(workspaceRoot, "report-task.txt"),
  ]
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8")
      const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      return Object.fromEntries(lines.map(line => {
        const [key, ...rest] = line.split("=")
        return [key, rest.join("=")]
      }))
    } catch {
      // Continue.
    }
  }
  return null
}

export async function runSonarCloudReview(input: ReviewScope): Promise<SonarCloudResult> {
  const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle)
  const sonar = input.reviewPolicy.sonarcloud
  if (!sonar.enabled) {
    const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.raw.txt", "skipped: disabled in workspace config\n")
    const rawGatePath = await writeArtifactText(artifactsDir, "sonar-gate.raw.json", "{\n  \"status\": \"skipped\"\n}\n")
    return {
      status: "skipped",
      reason: "sonarcloud-disabled",
      passed: false,
      conditions: [],
      findings: [],
      rawScanPath,
      rawGatePath,
      command: [],
      exitCode: 0,
    }
  }
  if (sonar.planTier === "free" && input.storyBranch !== (sonar.baseBranch ?? input.baseBranch)) {
    const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.raw.txt", "skipped: branch analysis unavailable on free plan\n")
    const rawGatePath = await writeArtifactText(artifactsDir, "sonar-gate.raw.json", "{\n  \"status\": \"skipped\",\n  \"reason\": \"sonarcloud-free-plan\"\n}\n")
    return {
      status: "skipped",
      reason: "sonarcloud-free-plan",
      passed: false,
      conditions: [],
      findings: [],
      rawScanPath,
      rawGatePath,
      command: [],
      exitCode: 0,
    }
  }
  if (!(await commandExists("sonar-scanner"))) {
    const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.raw.txt", "skipped: sonar-scanner missing\n")
    const rawGatePath = await writeArtifactText(artifactsDir, "sonar-gate.raw.json", "{\n  \"status\": \"skipped\"\n}\n")
    return {
      status: "skipped",
      reason: "sonar-scanner-missing",
      passed: false,
      conditions: [],
      findings: [],
      rawScanPath,
      rawGatePath,
      command: [],
      exitCode: 0,
    }
  }
  if (!sonar.projectKey || !sonar.organization) {
    const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.raw.txt", "skipped: sonar project metadata incomplete\n")
    const rawGatePath = await writeArtifactText(artifactsDir, "sonar-gate.raw.json", "{\n  \"status\": \"skipped\"\n}\n")
    return {
      status: "skipped",
      reason: "sonarcloud-config-incomplete",
      passed: false,
      conditions: [],
      findings: [],
      rawScanPath,
      rawGatePath,
      command: [],
      exitCode: 0,
    }
  }

  const token = process.env.SONAR_TOKEN ?? await readLocalEnvToken(input.workspaceRoot)
  if (!token) {
    const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.raw.txt", "failed: SONAR_TOKEN missing\n")
    const rawGatePath = await writeArtifactText(artifactsDir, "sonar-gate.raw.json", "{\n  \"status\": \"failed\",\n  \"reason\": \"sonar-token-missing\"\n}\n")
    return {
      status: "failed",
      reason: "sonar-token-missing",
      passed: false,
      conditions: [],
      findings: [],
      rawScanPath,
      rawGatePath,
      command: [],
      exitCode: 1,
    }
  }

  const command = [
    "sonar-scanner",
    `-Dsonar.projectKey=${sonar.projectKey}`,
    `-Dsonar.organization=${sonar.organization}`,
    `-Dsonar.host.url=${sonar.hostUrl ?? "https://sonarcloud.io"}`,
    `-Dsonar.branch.name=${input.storyBranch}`,
    `-Dsonar.branch.target=${sonar.baseBranch ?? input.baseBranch}`,
    ...(sonar.region === "us" ? ["-Dsonar.region=us"] : []),
  ]

  return withBranchLock(`${sonar.projectKey}:${input.storyBranch}`, async () => {
    const scan = await runCommand(command, input.workspaceRoot, {
      env: {
        SONAR_TOKEN: token,
      },
    })
    const rawScanPath = await writeArtifactText(artifactsDir, "sonar-scan.raw.txt", scan.combinedOutput)
    if (!scan.ok) {
      const rawGatePath = await writeArtifactText(artifactsDir, "sonar-gate.raw.json", "{\n  \"status\": \"failed\",\n  \"reason\": \"sonar-scanner-failed\"\n}\n")
      return {
        status: "failed",
        reason: "sonar-scanner-failed",
        passed: false,
        conditions: [],
        findings: [],
        rawScanPath,
        rawGatePath,
        command,
        exitCode: scan.exitCode,
      }
    }

    const reportTask = await findReportTask(input.workspaceRoot)
    if (!reportTask?.ceTaskUrl) {
      const rawGatePath = await writeArtifactText(artifactsDir, "sonar-gate.raw.json", "{\n  \"status\": \"failed\",\n  \"reason\": \"report-task-missing\"\n}\n")
      return {
        status: "failed",
        reason: "report-task-missing",
        passed: false,
        conditions: [],
        findings: [],
        rawScanPath,
        rawGatePath,
        command,
        exitCode: scan.exitCode,
      }
    }

    const ceTask = await waitForCeTask(reportTask.ceTaskUrl, token, sonar.scanTimeoutMs ?? DEFAULT_TIMEOUT_MS)
    if (!ceTask.analysisId) {
      const rawGatePath = await writeArtifactJson(artifactsDir, "sonar-gate.raw.json", ceTask)
      return {
        status: "failed",
        reason: ceTask.failureReason ?? "ce-task-failed",
        passed: false,
        conditions: [],
        findings: [],
        rawScanPath,
        rawGatePath,
        command,
        exitCode: scan.exitCode,
      }
    }

    const hostUrl = sonar.hostUrl ?? "https://sonarcloud.io"
    const projectKey = sonar.projectKey!
    const gatePayload = await fetchJson(
      `${hostUrl}/api/qualitygates/project_status?analysisId=${encodeURIComponent(ceTask.analysisId)}`,
      token,
    ) as {
      projectStatus?: { status?: string; conditions?: unknown[] }
    }
    const issuesPayload = await fetchJson(
      `${hostUrl}/api/issues/search?componentKeys=${encodeURIComponent(projectKey)}&branch=${encodeURIComponent(input.storyBranch)}&resolved=false&ps=500`,
      token,
    ) as {
      issues?: Array<Record<string, unknown>>
    }
    const conditions = mapConditions(gatePayload.projectStatus?.conditions)
    const findings = Array.isArray(issuesPayload.issues) ? issuesPayload.issues.map(mapIssueFinding) : []
    const rawGatePath = await writeArtifactJson(artifactsDir, "sonar-gate.raw.json", {
      gatePayload,
      issuesPayload,
    })
    return {
      status: "ran",
      passed: gatePayload.projectStatus?.status === "OK",
      conditions,
      findings,
      summary: gatePayload.projectStatus?.status === "OK" ? "Quality gate passed." : "Quality gate failed.",
      rawScanPath,
      rawGatePath,
      command,
      exitCode: scan.exitCode,
    }
  })
}
