import type { Finding } from "../types.js"
import { commandExists, runCommand } from "./commandRunner.js"
import { reviewCycleArtifactsDir, writeArtifactJson, writeArtifactText } from "./artifacts.js"
import type { CodeRabbitResult, ReviewScope } from "./types.js"

function normalizeSeverity(value: string): Finding<"coderabbit">["severity"] {
  switch (value) {
    case "critical":
      return "critical"
    case "major":
      return "high"
    case "minor":
      return "medium"
    case "trivial":
    case "info":
    default:
      return "low"
  }
}

function parseAgentOutput(output: string): {
  findings: Finding<"coderabbit">[]
  summary?: string
} {
  const findings: Finding<"coderabbit">[] = []
  const summaries: string[] = []
  for (const line of output.split(/\r?\n/).map(part => part.trim()).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>
      if (event.type === "finding") {
        let message = "CodeRabbit reported a finding."
        if (typeof event.codegenInstructions === "string") message = event.codegenInstructions
        else if (typeof event.message === "string") message = event.message
        else if (typeof event.fileName === "string") message = `Review finding in ${event.fileName}`
        findings.push({
          source: "coderabbit",
          severity: normalizeSeverity(typeof event.severity === "string" ? event.severity : "info"),
          message,
        })
      } else if (event.type === "status" && typeof event.message === "string") {
        summaries.push(event.message)
      } else if (event.type === "complete" && typeof event.summary === "string") {
        summaries.push(event.summary)
      } else if (event.type === "error" && typeof event.message === "string") {
        summaries.push(event.message)
      }
    } catch {
      // Ignore non-JSON lines and keep raw evidence persisted.
    }
  }
  return {
    findings,
    summary: summaries.at(-1),
  }
}

export async function runCodeRabbitReview(input: ReviewScope): Promise<CodeRabbitResult> {
  const artifactsDir = reviewCycleArtifactsDir(input.artifactsDir, input.reviewCycle)
  if (!input.reviewPolicy.coderabbit.enabled) {
    const rawPath = await writeArtifactText(artifactsDir, "coderabbit.raw.txt", "skipped: disabled in workspace config\n")
    return {
      status: "skipped",
      reason: "coderabbit-disabled",
      findings: [],
      rawPath,
      command: [],
      exitCode: 0,
    }
  }
  if (!(await commandExists("coderabbit")) && !(await commandExists("cr"))) {
    const rawPath = await writeArtifactText(artifactsDir, "coderabbit.raw.txt", "skipped: coderabbit CLI not available\n")
    return {
      status: "skipped",
      reason: "coderabbit-cli-missing",
      findings: [],
      rawPath,
      command: [],
      exitCode: 0,
    }
  }
  if (!input.baselineSha && input.changedFiles.length === 0) {
    const rawPath = await writeArtifactText(artifactsDir, "coderabbit.raw.txt", "skipped: no diff baseline or changed files\n")
    return {
      status: "skipped",
      reason: "coderabbit-no-diff",
      findings: [],
      rawPath,
      command: [],
      exitCode: 0,
    }
  }

  const binary = (await commandExists("coderabbit")) ? "coderabbit" : "cr"
  const command = [
    binary,
    "review",
    "--agent",
    "--dir",
    input.workspaceRoot,
    ...(input.baselineSha ? ["--base-commit", input.baselineSha] : []),
    ...(input.baseBranch ? ["--base", input.baseBranch] : []),
  ]
  const result = await runCommand(command, input.workspaceRoot)
  const rawPath = await writeArtifactText(artifactsDir, "coderabbit.raw.txt", result.combinedOutput)
  const parsed = parseAgentOutput(result.stdout)
  await writeArtifactJson(artifactsDir, "coderabbit.parsed.json", parsed)

  if (!result.ok && parsed.findings.length === 0) {
    return {
      status: "failed",
      reason: "coderabbit-command-failed",
      findings: [],
      rawPath,
      command,
      exitCode: result.exitCode,
    }
  }

  return {
    status: "ran",
    findings: parsed.findings,
    summary: parsed.summary,
    rawPath,
    command,
    exitCode: result.exitCode,
  }
}
