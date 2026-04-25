import type { Item, Phase, Workspace } from "./types";

const ENGINE_URL =
  process.env.ENGINE_URL ?? process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:4100";

const STAGE_TO_PHASE: Record<string, Phase> = {
  brainstorm: "Frontend",
  "visual-companion": "Frontend",
  "frontend-design": "Frontend",
  architecture: "Implementation",
  planning: "Implementation",
  execution: "Implementation",
  "project-review": "Implementation",
  qa: "Test",
  documentation: "Merge",
  handoff: "Merge",
};

const COLUMN_TO_PHASE: Record<string, Phase> = {
  idea: "Idea",
  requirements: "Requirements",
  done: "Merge",
};

export function deriveBoardPhase(args: {
  column?: string | null;
  currentStage?: string | null;
}): Phase {
  const stage = args.currentStage ?? "";
  if (stage && STAGE_TO_PHASE[stage]) return STAGE_TO_PHASE[stage]!;
  const col = args.column ?? "";
  if (col && COLUMN_TO_PHASE[col]) return COLUMN_TO_PHASE[col]!;
  return "Idea";
}

interface RawBoardCard {
  id: string;
  itemCode?: string;
  item_code?: string;
  title: string;
  summary?: string | null;
  column?: string | null;
  current_stage?: string | null;
  pipelineState?: string;
  pipeline_state?: string;
  phase_status?: string | null;
  openPrompt?: { id: string } | null;
}

export async function fetchBoard(workspaceKey: string): Promise<Item[]> {
  const url = `${ENGINE_URL}/board?workspace=${encodeURIComponent(workspaceKey)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const payload = (await res.json()) as { cards?: RawBoardCard[] } | RawBoardCard[];
    const cards = Array.isArray(payload) ? payload : payload.cards ?? [];
    return cards.map((c): Item => {
      const phase = deriveBoardPhase({
        column: c.column,
        currentStage: c.current_stage,
      });
      const pipelineState = derivePipelineState(c);
      return {
        id: c.id,
        itemCode: c.itemCode ?? c.item_code ?? c.id,
        title: c.title,
        summary: c.summary ?? null,
        phase,
        pipelineState,
      };
    });
  } catch {
    return [];
  }
}

function derivePipelineState(c: RawBoardCard): string {
  if (c.openPrompt) return "openPrompt";
  if (c.phase_status === "blocked") return "run-blocked";
  if (c.phase_status === "review-waiting") return "review-gate-waiting";
  return c.pipelineState ?? c.pipeline_state ?? c.phase_status ?? "idle";
}

export function buildSseUrl(workspaceKey: string): string {
  return `${ENGINE_URL}/events?workspace=${encodeURIComponent(workspaceKey)}&level=2`;
}

interface RawWorkspace {
  key?: string | null;
  name?: string | null;
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const url = `${ENGINE_URL}/workspaces`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const payload = (await res.json()) as
      | { workspaces?: RawWorkspace[] }
      | RawWorkspace[];
    const list = Array.isArray(payload) ? payload : payload.workspaces ?? [];
    const out: Workspace[] = [];
    for (const w of list) {
      if (typeof w?.key === "string" && w.key.length > 0) {
        out.push({ key: w.key, name: typeof w.name === "string" && w.name.length > 0 ? w.name : w.key });
      }
    }
    return out;
  } catch {
    return [];
  }
}
