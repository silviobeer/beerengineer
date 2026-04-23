import { spawn, type ChildProcess } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(process.cwd(), "..", "..")
const ENGINE_BIN = resolve(ROOT, "apps", "engine", "bin", "beerengineer.js")

const runningChildren = new Set<ChildProcess>()

function registerChild(child: ChildProcess): void {
  runningChildren.add(child)
  const cleanup = () => runningChildren.delete(child)
  child.once("exit", cleanup)
  child.once("error", cleanup)
}

function cliEnv(): NodeJS.ProcessEnv {
  return { ...process.env }
}

export async function startCliWorkflow(input: {
  title: string
  description: string
  workspaceKey?: string
}): Promise<{ runId: string } | { error: string; status?: number }> {
  const args = [ENGINE_BIN, "run", "--json"]
  if (input.workspaceKey?.trim()) {
    args.push("--workspace", input.workspaceKey.trim())
  }

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: cliEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  })
  registerChild(child)

  return await new Promise(resolvePromise => {
    let resolved = false
    let bootstrapAnswerIndex = 0
    let stdoutBuffer = ""
    let stderrBuffer = ""

    const finish = (result: { runId: string } | { error: string; status?: number }) => {
      if (resolved) return
      resolved = true
      resolvePromise(result)
    }

    child.stdout?.on("data", chunk => {
      stdoutBuffer += chunk.toString("utf8")
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const event = JSON.parse(trimmed) as {
            type?: string
            promptId?: string
            runId?: string
          }
          if (event.type === "prompt_requested" && typeof event.promptId === "string") {
            const answer = bootstrapAnswerIndex === 0 ? input.title : bootstrapAnswerIndex === 1 ? input.description : null
            bootstrapAnswerIndex += 1
            if (answer !== null) {
              child.stdin?.write(`${JSON.stringify({ type: "prompt_answered", promptId: event.promptId, answer })}\n`)
            }
          }
          if ((event.type === "run_started" || event.type === "cli_finished") && typeof event.runId === "string") {
            finish({ runId: event.runId })
          }
        } catch {
          // ignore non-json lines
        }
      }
    })

    child.stderr?.on("data", chunk => {
      stderrBuffer += chunk.toString("utf8")
    })

    child.once("exit", code => {
      if (!resolved) {
        finish({
          error: stderrBuffer.trim() || `workflow_cli_exit_${code ?? "unknown"}`,
          status: code ?? undefined,
        })
      }
    })

    child.once("error", err => {
      finish({ error: err.message })
    })
  })
}

export async function runCliItemAction(input: {
  itemRef: string
  action: "start_brainstorm" | "start_implementation"
}): Promise<
  | { ok: true; runId: string }
  | { ok: false; status: number; error: string }
> {
  const child = spawn(
    process.execPath,
    [ENGINE_BIN, "item", "action", "--item", input.itemRef, "--action", input.action],
    {
      cwd: ROOT,
      env: cliEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    }
  )
  registerChild(child)

  return await new Promise(resolvePromise => {
    let resolved = false
    let stdout = ""
    let stderr = ""

    const finish = (result: { ok: true; runId: string } | { ok: false; status: number; error: string }) => {
      if (resolved) return
      resolved = true
      resolvePromise(result)
    }

    child.stdout?.on("data", chunk => {
      stdout += chunk.toString("utf8")
      const match = stdout.match(/run-id:\s*([a-f0-9-]+)/i)
      if (match) {
        finish({ ok: true, runId: match[1]! })
      }
    })

    child.stderr?.on("data", chunk => {
      stderr += chunk.toString("utf8")
    })

    child.once("exit", code => {
      if (resolved) return
      finish({
        ok: false,
        status: code ?? 1,
        error: stderr.trim() || stdout.trim() || `item_action_exit_${code ?? "unknown"}`,
      })
    })

    child.once("error", err => {
      finish({ ok: false, status: 1, error: err.message })
    })
  })
}
