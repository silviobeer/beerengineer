import { spawn } from "node:child_process"

export type CommandRunResult = {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  combinedOutput: string
  timedOut?: boolean
}

const VERSION_PROBE_TIMEOUT_MS = 5_000
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000

export async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand([command, "--version"], process.cwd(), {
    timeoutMs: VERSION_PROBE_TIMEOUT_MS,
  })
  return result.ok
}

export function runCommand(
  command: string[],
  cwd: string,
  opts: {
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
  } = {},
): Promise<CommandRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  return new Promise(resolve => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    const settle = (result: CommandRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))
    child.on("error", err => {
      settle({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        combinedOutput: err.message,
        timedOut,
      })
    })
    child.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8")
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      const extra = timedOut ? `\n[timed out after ${timeoutMs}ms]` : ""
      settle({
        ok: !timedOut && code === 0,
        exitCode: code ?? 1,
        stdout,
        stderr,
        combinedOutput: [stdout, stderr].filter(Boolean).join("\n") + extra,
        timedOut,
      })
    })
  })
}
