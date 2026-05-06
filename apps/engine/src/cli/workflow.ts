import { ask, close } from "../sim/human.js"
import { NON_INTERACTIVE_NO_ANSWER_SENTINEL } from "../core/constants.js"
import { createCliIO } from "../core/ioCli.js"
import { getRegisteredWorkspace } from "../core/workspaces.js"
import { runWorkflowWithSync } from "../core/runOrchestrator.js"
import { initDatabase } from "../db/connection.js"
import { Repos } from "../db/repositories.js"

function resolveWorkspaceMeta(
  repos: Repos,
  workspaceKey: string | undefined,
): { workspaceKey?: string; workspaceName?: string } {
  if (!workspaceKey) return {}
  const workspace = getRegisteredWorkspace(repos, workspaceKey)
  if (!workspace) throw new Error(`Unknown workspace: ${workspaceKey}`)
  return { workspaceKey: workspace.key, workspaceName: workspace.name }
}

export async function runInteractiveWorkflow(opts: { json?: boolean; workspaceKey?: string } = {}): Promise<void> {
  if (opts.json) return runJsonWorkflow({ workspaceKey: opts.workspaceKey })

  console.log("\n  ╔══════════════════════════════════════════════════╗")
  console.log("  ║   beerengineer_                                  ║")
  console.log("  ║   Hand me an idea. Hold your beer.               ║")
  console.log("  ╚══════════════════════════════════════════════════╝\n")

  const title = await ask("  Idea (title):        ")
  const description = await ask("  Idea (description):  ")

  const db = initDatabase()
  const repos = new Repos(db)
  const io = createCliIO(repos)

  try {
    const workspaceMeta = resolveWorkspaceMeta(repos, opts.workspaceKey)
    const runId = await runWorkflowWithSync(
      { id: "new", title, description },
      repos,
      io,
      { owner: "cli", ...workspaceMeta }
    )
    console.log(`\n  run-id: ${runId}`)
  } finally {
    io.close?.()
    close()
    db.close()
  }
}

async function runJsonWorkflow(opts: { workspaceKey?: string } = {}): Promise<void> {
  const { attachNdjsonRenderer } = await import("../core/renderers/ndjson.js")
  const db = initDatabase()
  const repos = new Repos(db)
  const io = createCliIO(repos, {
    renderer: (bus) => attachNdjsonRenderer(bus),
    externalPromptResolver: true,
  })

  try {
    const title = requireJsonPromptAnswer(await io.ask("Idea (title)"), "Idea (title)")
    const description = requireJsonPromptAnswer(await io.ask("Idea (description)"), "Idea (description)")

    const workspaceMeta = resolveWorkspaceMeta(repos, opts.workspaceKey)
    const runId = await runWorkflowWithSync(
      { id: "new", title, description },
      repos,
      io,
      { owner: "cli", ...workspaceMeta }
    )
    process.stdout.write(`${JSON.stringify({ type: "cli_finished", runId })}\n`)
  } finally {
    io.close?.()
    db.close()
  }
}

function requireJsonPromptAnswer(answer: string, prompt: string): string {
  if (answer !== NON_INTERACTIVE_NO_ANSWER_SENTINEL) return answer
  throw new Error(
    `Prompt "${prompt}" was not answered before stdin closed. ` +
    "In --json mode, reply on stdin with a JSON line: " +
    '{"type":"prompt_answered","promptId":"<from prompt_requested>","answer":"<answer>"}.',
  )
}
