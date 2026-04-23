import { mkdtemp, readFile, rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ReviewAgentAdapter, StageAgentAdapter, StageAgentInput } from "../../core/adapters.js"
import type { RuntimePolicy } from "../registry.js"
import type { HostedCliRequest, HostedProviderId } from "./promptEnvelope.js"
import { mapReviewEnvelopeToResponse, mapStageEnvelopeToResponse, type HostedReviewOutputEnvelope, type HostedStageOutputEnvelope } from "./outputEnvelope.js"
import { buildReviewPrompt, buildStagePrompt } from "./promptEnvelope.js"

export type HostedCliExecutionResult = {
  stdout: string
  stderr: string
  exitCode: number
  command: string[]
  outputText: string
}

type ProviderCommandBuilder = (input: {
  provider: HostedProviderId
  model?: string
  workspaceRoot: string
  policy: RuntimePolicy
  responsePath: string
}) => string[]

export async function runHostedCli(
  request: HostedCliRequest,
  buildCommand: ProviderCommandBuilder,
): Promise<HostedCliExecutionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "beerengineer-hosted-"))
  const responsePath = join(tempDir, "last-message.txt")
  const command = buildCommand({
    provider: request.runtime.provider,
    model: request.runtime.model,
    workspaceRoot: request.runtime.workspaceRoot,
    policy: request.runtime.policy,
    responsePath,
  })

  try {
    const result = await spawnCommand(command, request.prompt, request.runtime.workspaceRoot)
    const outputText = await resolveOutputText(result.stdout, responsePath)
    if (result.exitCode !== 0) {
      throw new Error(
        `${request.runtime.provider} exited with code ${result.exitCode}: ${result.stderr || result.stdout || "no output"}`,
      )
    }
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      command,
      outputText,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function resolveOutputText(stdout: string, responsePath: string): Promise<string> {
  try {
    const fromFile = await readFile(responsePath, "utf8")
    if (fromFile.trim()) return fromFile
  } catch {
    // Provider did not use an output file; fall back to stdout.
  }
  return stdout
}

function spawnCommand(command: string[], stdinText: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    child.once("error", err => settle(() => reject(err)))
    child.stdout.on("data", chunk => stdoutChunks.push(chunk as Buffer))
    child.stderr.on("data", chunk => stderrChunks.push(chunk as Buffer))
    child.once("close", code => {
      settle(() =>
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: code ?? 1,
        }),
      )
    })
    child.stdin.write(stdinText)
    child.stdin.end()
  })
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const candidates: string[] = []
  candidates.push(trimmed)
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) candidates.push(fence[1].trim())
  const outermost = extractOutermostJsonObject(trimmed)
  if (outermost) candidates.push(outermost)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`Provider output did not contain a JSON object: ${trimmed.slice(0, 200)}`)
}

// Scan for the outermost balanced {...} block, ignoring braces inside strings.
// Robust against markdown prose before/after and embedded example objects.
function extractOutermostJsonObject(text: string): string | null {
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === "\\") escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

export class HostedStageAdapter<S, A> implements StageAgentAdapter<S, A> {
  constructor(
    private readonly input: {
      stageId: string
      provider: HostedProviderId
      model?: string
      workspaceRoot: string
      runtimePolicy: RuntimePolicy
      buildCommand: ProviderCommandBuilder
    },
  ) {}

  async step(request: StageAgentInput<S>) {
    const basePrompt = buildStagePrompt({
      stageId: this.input.stageId,
      provider: this.input.provider,
      model: this.input.model,
      runtimePolicy: this.input.runtimePolicy,
      request,
    })
    const runtime = {
      provider: this.input.provider,
      model: this.input.model,
      workspaceRoot: this.input.workspaceRoot,
      policy: this.input.runtimePolicy,
    }
    const firstResult = await runHostedCli(
      { kind: "stage", runtime, prompt: basePrompt, payload: request },
      this.input.buildCommand,
    )
    try {
      return mapStageEnvelopeToResponse(parseJsonObject(firstResult.outputText) as HostedStageOutputEnvelope<A>)
    } catch (err) {
      const retryPrompt = `${basePrompt}\n\nIMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now.\n\nPrevious response (for your reference):\n${firstResult.outputText.slice(0, 2000)}`
      const retryResult = await runHostedCli(
        { kind: "stage", runtime, prompt: retryPrompt, payload: request },
        this.input.buildCommand,
      )
      try {
        return mapStageEnvelopeToResponse(parseJsonObject(retryResult.outputText) as HostedStageOutputEnvelope<A>)
      } catch {
        throw err
      }
    }
  }
}

export class HostedReviewAdapter<S, A> implements ReviewAgentAdapter<S, A> {
  constructor(
    private readonly input: {
      stageId: string
      provider: HostedProviderId
      model?: string
      workspaceRoot: string
      runtimePolicy: RuntimePolicy
      buildCommand: ProviderCommandBuilder
    },
  ) {}

  async review(request: { artifact: A; state: S }) {
    const basePrompt = buildReviewPrompt({
      stageId: this.input.stageId,
      provider: this.input.provider,
      model: this.input.model,
      runtimePolicy: this.input.runtimePolicy,
      request,
    })
    const runtime = {
      provider: this.input.provider,
      model: this.input.model,
      workspaceRoot: this.input.workspaceRoot,
      policy: this.input.runtimePolicy,
    }
    const firstResult = await runHostedCli(
      { kind: "review", runtime, prompt: basePrompt, payload: request },
      this.input.buildCommand,
    )
    try {
      return mapReviewEnvelopeToResponse(parseJsonObject(firstResult.outputText) as HostedReviewOutputEnvelope)
    } catch (err) {
      const retryPrompt = `${basePrompt}\n\nIMPORTANT: your previous response was not valid JSON. You MUST respond with ONLY a single JSON object that matches the review output envelope schema — no prose before or after, no markdown, no code fences. Respond with the JSON object now.\n\nPrevious response (for your reference):\n${firstResult.outputText.slice(0, 2000)}`
      const retryResult = await runHostedCli(
        { kind: "review", runtime, prompt: retryPrompt, payload: request },
        this.input.buildCommand,
      )
      try {
        return mapReviewEnvelopeToResponse(parseJsonObject(retryResult.outputText) as HostedReviewOutputEnvelope)
      } catch {
        throw err
      }
    }
  }
}

export { parseJsonObject }
