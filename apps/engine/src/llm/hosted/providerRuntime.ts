import { spawn } from "node:child_process"
import type { HostedCliRequest, HostedProviderId } from "./promptEnvelope.js"

export type HostedSession = {
  provider: HostedProviderId
  sessionId: string | null
}

export type HostedCliExecutionResult = {
  stdout: string
  stderr: string
  exitCode: number
  command: string[]
  outputText: string
  session: HostedSession
  cacheStats?: {
    cachedInputTokens: number
    totalInputTokens: number
  }
}

export type HostedProviderInvokeInput = {
  prompt: string
  session?: HostedSession | null
  runtime: HostedCliRequest["runtime"]
}

export function spawnCommand(command: string[], stdinText: string | null, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
    if (stdinText != null) child.stdin.write(stdinText)
    child.stdin.end()
  })
}
