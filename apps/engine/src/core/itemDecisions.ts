import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { layout } from "./workspaceLayout.js"

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

function decisionsPath(workspaceId: string): string {
  return join(layout.workspaceDir(workspaceId), "decisions.json")
}

function readFile(workspaceId: string): DecisionsFile | null {
  const path = decisionsPath(workspaceId)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DecisionsFile>
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.decisions)) return null
    return { schemaVersion: 1, decisions: raw.decisions }
  } catch {
    return null
  }
}

function writeFileSafe(workspaceId: string, content: DecisionsFile): void {
  const path = decisionsPath(workspaceId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(content, null, 2), "utf8")
}

export function loadItemDecisions(workspaceId: string | undefined | null): ItemDecision[] {
  if (!workspaceId) return []
  return readFile(workspaceId)?.decisions ?? []
}

// Decisions are append-only; the same prompt id is treated as an update
// (operator changed their mind) so we keep the most recent answer.
export function appendItemDecision(workspaceId: string, decision: ItemDecision): void {
  const current = readFile(workspaceId) ?? { schemaVersion: 1 as const, decisions: [] }
  const filtered = current.decisions.filter(d => d.id !== decision.id)
  filtered.push(decision)
  writeFileSafe(workspaceId, { schemaVersion: 1, decisions: filtered })
}
