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
    const result = await spawnCommand(command, request.prompt)
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

function spawnCommand(command: string[], stdinText: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.on("error", reject)
    child.stdout.on("data", chunk => stdoutChunks.push(chunk as Buffer))
    child.stderr.on("data", chunk => stderrChunks.push(chunk as Buffer))
    child.on("close", code => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: code ?? 1,
      })
    })
    child.stdin.write(stdinText)
    child.stdin.end()
  })
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence?.[1]?.trim() ?? trimmed
  const first = candidate.indexOf("{")
  const last = candidate.lastIndexOf("}")
  if (first < 0 || last < first) {
    throw new Error(`Provider output did not contain a JSON object: ${candidate.slice(0, 200)}`)
  }
  return JSON.parse(candidate.slice(first, last + 1)) as Record<string, unknown>
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
    const result = await runHostedCli(
      {
        kind: "stage",
        runtime: {
          provider: this.input.provider,
          model: this.input.model,
          workspaceRoot: this.input.workspaceRoot,
          policy: this.input.runtimePolicy,
        },
        prompt: buildStagePrompt({
          stageId: this.input.stageId,
          provider: this.input.provider,
          model: this.input.model,
          runtimePolicy: this.input.runtimePolicy,
          request,
        }),
        payload: request,
      },
      this.input.buildCommand,
    )
    return mapStageEnvelopeToResponse(parseJsonObject(result.outputText) as HostedStageOutputEnvelope<A>)
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
    const result = await runHostedCli(
      {
        kind: "review",
        runtime: {
          provider: this.input.provider,
          model: this.input.model,
          workspaceRoot: this.input.workspaceRoot,
          policy: this.input.runtimePolicy,
        },
        prompt: buildReviewPrompt({
          stageId: this.input.stageId,
          provider: this.input.provider,
          model: this.input.model,
          runtimePolicy: this.input.runtimePolicy,
          request,
        }),
        payload: request,
      },
      this.input.buildCommand,
    )
    return mapReviewEnvelopeToResponse(parseJsonObject(result.outputText) as HostedReviewOutputEnvelope)
  }
}

export { parseJsonObject }
