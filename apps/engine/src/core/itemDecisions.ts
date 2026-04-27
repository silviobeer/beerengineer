import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { layout, type WorkflowContext } from "./workspaceLayout.js"

export type ItemDecision = {
  id: string
  stage: string | null
  question: string
  answer: string
  runId: string
  answeredAt: string
}

type DecisionsFile = {
  schemaVersion: 1
  decisions: ItemDecision[]
}

function decisionsPath(ctx: Pick<WorkflowContext, "workspaceId" | "workspaceRoot">): string {
  return join(layout.workspaceDir(ctx), "decisions.json")
}

function readFile(ctx: Pick<WorkflowContext, "workspaceId" | "workspaceRoot">): DecisionsFile | null {
  const path = decisionsPath(ctx)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DecisionsFile>
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.decisions)) return null
    return { schemaVersion: 1, decisions: raw.decisions }
  } catch {
    return null
  }
}

function writeFileSafe(ctx: Pick<WorkflowContext, "workspaceId" | "workspaceRoot">, content: DecisionsFile): void {
  const path = decisionsPath(ctx)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(content, null, 2), "utf8")
}

export function loadItemDecisions(ctx: Pick<WorkflowContext, "workspaceId" | "workspaceRoot"> | undefined | null): ItemDecision[] {
  if (!ctx?.workspaceId || !ctx.workspaceRoot) return []
  return readFile(ctx)?.decisions ?? []
}

// Decisions are append-only; the same prompt id is treated as an update
// (operator changed their mind) so we keep the most recent answer.
export function appendItemDecision(ctx: Pick<WorkflowContext, "workspaceId" | "workspaceRoot">, decision: ItemDecision): void {
  const current = readFile(ctx) ?? { schemaVersion: 1 as const, decisions: [] }
  const filtered = current.decisions.filter(d => d.id !== decision.id)
  filtered.push(decision)
  writeFileSafe(ctx, { schemaVersion: 1, decisions: filtered })
}
