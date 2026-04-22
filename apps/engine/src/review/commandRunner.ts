import { spawn } from "node:child_process"

export type CommandRunResult = {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  combinedOutput: string
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand([command, "--version"], process.cwd())
  return result.ok
}

export function runCommand(
  command: string[],
  cwd: string,
  opts: {
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<CommandRunResult> {
  return new Promise(resolve => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))
    child.on("error", err => {
      resolve({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        combinedOutput: err.message,
      })
    })
    child.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8")
      const stderr = Buffer.concat(stderrChunks).toString("utf8")
      resolve({
        ok: code === 0,
        exitCode: code ?? 1,
        stdout,
        stderr,
        combinedOutput: [stdout, stderr].filter(Boolean).join("\n"),
      })
    })
  })
}
