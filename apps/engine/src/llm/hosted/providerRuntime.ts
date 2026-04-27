import { spawn } from "node:child_process"
import type { HostedHarness, HostedRequest } from "./promptEnvelope.js"

export type HostedSession = {
  harness: HostedHarness
  sessionId: string | null
  /**
   * SDK runtimes that lack a server-side session handle replay the local
   * message history on every step. CLI runtimes ignore this field. See
   * `providers/_sdkSession.ts`.
   */
  messages?: import("../types.js").ChatMessage[]
}

export type HostedInvocationResult = {
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

/** @deprecated Use `HostedInvocationResult`. */
export type HostedCliExecutionResult = HostedInvocationResult

export type HostedProviderInvokeInput = {
  prompt: string
  session?: HostedSession | null
  runtime: HostedRequest["runtime"]
}

export type SpawnCommandOptions = {
  onStdoutLine?: (line: string) => void
}

export function spawnCommand(
  command: string[],
  stdinText: string | null,
  cwd: string,
  options: SpawnCommandOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let lineBuffer = ""
    let settled = false
    let stdinClosed = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    const ignoreBrokenPipe = (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED") return
      settle(() => reject(err))
    }
    const flushLines = (final = false) => {
      if (!options.onStdoutLine) return
      const parts = lineBuffer.split(/\r?\n/)
      lineBuffer = final ? "" : parts.pop() ?? ""
      for (const line of parts) {
        if (line.length === 0) continue
        try {
          options.onStdoutLine(line)
        } catch {
          // Never let a logging callback take down the subprocess waiter.
        }
      }
    }
    child.once("error", err => settle(() => reject(err)))
    child.stdin.on("error", ignoreBrokenPipe)
    child.stdin.on("close", () => {
      stdinClosed = true
    })
    child.stdout.on("data", chunk => {
      stdoutChunks.push(chunk as Buffer)
      if (options.onStdoutLine) {
        lineBuffer += (chunk as Buffer).toString("utf8")
        flushLines()
      }
    })
    child.stderr.on("data", chunk => stderrChunks.push(chunk as Buffer))
    child.once("close", code => {
      flushLines(true)
      settle(() =>
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: code ?? 1,
        }),
      )
    })
    if (stdinText != null && !stdinClosed && !child.stdin.destroyed) {
      child.stdin.write(stdinText, err => {
        if (err) ignoreBrokenPipe(err)
      })
    }
    if (!stdinClosed && !child.stdin.destroyed) child.stdin.end()
  })
}
