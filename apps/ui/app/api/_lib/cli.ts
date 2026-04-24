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

type SpawnSuccess = { runId: string }
type SpawnFailure = { error: string; status?: number }
type SpawnResult = SpawnSuccess | SpawnFailure

/**
 * One of the two resolution strategies a CLI invocation can use:
 *
 *  - `"ndjson"`: parse stdout as newline-delimited JSON events. Resolve on
 *     the first event with a `runId` (typically `run_started`). Optional
 *     `bootstrapAnswers` feed initial `prompt_requested` events back on
 *     stdin (used by `POST /api/runs` to ferry title/description through
 *     the CLI's interactive prompts).
 *  - `"text"`: scan stdout text for a regex matching the runId (used by
 *     `item-action` subcommands, which print `run-id: <uuid>`).
 */
type SpawnStrategy =
  | { kind: "ndjson"; bootstrapAnswers?: string[] }
  | { kind: "text"; runIdPattern: RegExp }

async function spawnEngineCli(args: string[], strategy: SpawnStrategy): Promise<SpawnResult> {
  const child = spawn(process.execPath, [ENGINE_BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  })
  registerChild(child)

  return await new Promise(resolvePromise => {
    let resolved = false
    let stdoutBuffer = ""
    let stderrBuffer = ""
    let bootstrapIndex = 0

    const finish = (result: SpawnResult): void => {
      if (resolved) return
      resolved = true
      // Once we have the runId, the rest of the workflow talks to the UI
      // through DB-backed events and prompts. Release the CLI from this
      // request worker so it survives past the response.
      child.stdin?.end()
      child.unref()
      resolvePromise(result)
    }

    const handleNdjsonLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      let event: { type?: string; promptId?: string; runId?: string }
      try {
        event = JSON.parse(trimmed)
      } catch {
        return
      }
      if (strategy.kind !== "ndjson") return
      if (event.type === "prompt_requested" && typeof event.promptId === "string") {
        const answers = strategy.bootstrapAnswers ?? []
        const answer = bootstrapIndex < answers.length ? answers[bootstrapIndex] : null
        bootstrapIndex += 1
        if (answer !== null) {
          child.stdin?.write(`${JSON.stringify({ type: "prompt_answered", promptId: event.promptId, answer })}\n`)
        }
      }
      if ((event.type === "run_started" || event.type === "cli_finished") && typeof event.runId === "string") {
        finish({ runId: event.runId })
      }
    }

    child.stdout?.on("data", chunk => {
      stdoutBuffer += chunk.toString("utf8")
      if (strategy.kind === "ndjson") {
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ""
        lines.forEach(handleNdjsonLine)
        return
      }
      const match = stdoutBuffer.match(strategy.runIdPattern)
      if (match?.[1]) finish({ runId: match[1] })
    })

    child.stderr?.on("data", chunk => {
      stderrBuffer += chunk.toString("utf8")
    })

    child.once("exit", code => {
      if (resolved) return
      finish({
        error: stderrBuffer.trim() || stdoutBuffer.trim() || `engine_cli_exit_${code ?? "unknown"}`,
        status: code ?? undefined,
      })
    })

    child.once("error", err => {
      finish({ error: err.message })
    })
  })
}

function isSpawnSuccess(result: SpawnResult): result is SpawnSuccess {
  return "runId" in result
}

/**
 * `POST /api/runs` — spawn the interactive `beerengineer run --json`
 * workflow, ferrying title/description through the first two
 * `prompt_requested` events so the UI caller can return a runId immediately.
 */
export async function startCliWorkflow(input: {
  title: string
  description: string
  workspaceKey?: string
}): Promise<SpawnResult> {
  const args = ["run", "--json"]
  if (input.workspaceKey?.trim()) args.push("--workspace", input.workspaceKey.trim())
  return spawnEngineCli(args, {
    kind: "ndjson",
    bootstrapAnswers: [input.title, input.description],
  })
}

/** `POST /api/items/:id/actions` for start_brainstorm / start_implementation. */
export async function runCliItemAction(input: {
  itemRef: string
  action: "start_brainstorm" | "start_implementation"
}): Promise<{ ok: true; runId: string } | { ok: false; status: number; error: string }> {
  const result = await spawnEngineCli(
    ["item", "action", "--item", input.itemRef, "--action", input.action],
    { kind: "text", runIdPattern: /run-id:\s*([a-f0-9-]+)/i },
  )
  return isSpawnSuccess(result)
    ? { ok: true, runId: result.runId }
    : { ok: false, status: result.status ?? 1, error: result.error }
}

/**
 * `POST /api/runs/:id/resume` — spawn the CLI to re-enter a blocked run via
 * `item action --action resume_run` with the remediation flags. `--yes`
 * skips the interactive remediation prompt (UI has already collected the
 * fields).
 */
export async function runCliResume(input: {
  itemRef: string
  summary: string
  branch?: string
  commit?: string
  reviewNotes?: string
}): Promise<{ ok: true; runId: string } | { ok: false; status: number; error: string }> {
  const args = [
    "item", "action",
    "--item", input.itemRef,
    "--action", "resume_run",
    "--remediation-summary", input.summary,
    "--yes",
  ]
  if (input.branch) args.push("--branch", input.branch)
  if (input.commit) args.push("--commit", input.commit)
  if (input.reviewNotes) args.push("--notes", input.reviewNotes)

  const result = await spawnEngineCli(args, { kind: "text", runIdPattern: /run-id:\s*([a-f0-9-]+)/i })
  return isSpawnSuccess(result)
    ? { ok: true, runId: result.runId }
    : { ok: false, status: result.status ?? 1, error: result.error }
}
