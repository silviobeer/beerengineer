import { BoardWorkspaceView } from "@/components/BoardWorkspaceView";
import { RunOverviewBanners } from "@/components/run/RunOverviewBanners";
import { engineBaseUrl } from "@/lib/engine/baseUrl";
import {
  CHAT_ENTRY_FACT_FRESHNESS,
  MESSAGES_ENTRY_FACT_FRESHNESS,
  normalizeRunEntryFact,
  normalizeRunEntryFreshness,
  type RunEntryFact,
  type RunEntryFactFreshness,
} from "@/lib/runEntryFacts";
import type { BoardCardDTO } from "@/lib/types";
import type { VisibleActionFactsFreshness, VisibleActionId } from "@/lib/visibleActionFacts";

interface BoardApiItem {
  id?: string;
  itemId?: string;
  itemCode?: string;
  title?: string;
  summary?: string | null;
  phase?: string;
  column?: string;
  phase_status?: string | null;
  phaseStatus?: string | null;
  hasOpenPrompt?: boolean;
  hasReviewGateWaiting?: boolean;
  hasBlockedRun?: boolean;
  recovery_user_message?: string | null;
  previewUrl?: string;
  current_stage?: string | null;
  currentStage?: string | null;
  supabaseBlocker?: BoardCardDTO["supabaseBlocker"];
  visibleActions?: VisibleActionId[];
  visibleActionsFreshness?: VisibleActionFactsFreshness;
  chatEntry?: RunEntryFact;
  chatEntryFreshness?: RunEntryFactFreshness;
  messagesEntry?: RunEntryFact;
  messagesEntryFreshness?: RunEntryFactFreshness;
}

interface BoardApiColumn {
  key?: string;
  title?: string;
  cards?: BoardApiItem[];
}

interface BoardApiResponse {
  items?: BoardApiItem[];
  columns?: BoardApiColumn[];
  costRisk?: {
    retainedBranchCount: number;
    planLimitRatio: number;
  };
}

function toBoardCard(item: BoardApiItem): BoardCardDTO {
  const id = item.itemId ?? item.id ?? item.itemCode ?? "";
  const engineColumn = item.phase ?? item.column ?? "idea";
  const currentStage = item.current_stage ?? item.currentStage ?? null;
  const chatEntry = normalizeRunEntryFact(item.chatEntry);
  const messagesEntry = normalizeRunEntryFact(item.messagesEntry);
  return {
    id,
    itemCode: item.itemCode,
    title: item.title ?? "",
    summary: item.summary ?? null,
    column: engineColumn,
    phase_status: item.phase_status ?? item.phaseStatus ?? null,
    hasOpenPrompt: Boolean(item.hasOpenPrompt),
    hasReviewGateWaiting: Boolean(item.hasReviewGateWaiting),
    hasBlockedRun: Boolean(item.hasBlockedRun),
    recovery_user_message: item.recovery_user_message ?? null,
    previewUrl: typeof item.previewUrl === "string" ? item.previewUrl : undefined,
    current_stage: currentStage,
    supabaseBlocker: item.supabaseBlocker,
    chatEntry: chatEntry.fact,
    chatEntryFreshness: normalizeRunEntryFreshness(item.chatEntryFreshness, CHAT_ENTRY_FACT_FRESHNESS),
    chatEntryMissing: chatEntry.missing,
    messagesEntry: messagesEntry.fact,
    messagesEntryFreshness: normalizeRunEntryFreshness(item.messagesEntryFreshness, MESSAGES_ENTRY_FACT_FRESHNESS),
    messagesEntryMissing: messagesEntry.missing,
    visibleActions: Array.isArray(item.visibleActions) ? item.visibleActions : undefined,
    visibleActionsFreshness: item.visibleActionsFreshness,
  };
}

async function fetchBoard(
  workspaceKey: string
): Promise<{ items: BoardCardDTO[] | null; costRisk?: BoardApiResponse["costRisk"]; error: string | null }> {
  try {
    const res = await fetch(
      `${engineBaseUrl()}/board?workspace=${encodeURIComponent(workspaceKey)}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) {
      return { items: null, error: `engine responded ${res.status}` };
    }
    const data = (await res.json()) as BoardApiResponse;
    let flatItems: BoardApiItem[] = [];
    if (Array.isArray(data.items)) {
      flatItems = data.items;
    } else if (Array.isArray(data.columns)) {
      flatItems = data.columns.flatMap((col) =>
        (col.cards ?? []).map((card) => ({
          ...card,
          phase: card.phase ?? card.column ?? col.key,
        })),
      );
    }
    const items = flatItems.map(toBoardCard);
    return { items, costRisk: data.costRisk, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return { items: null, error: message };
  }
}

interface BoardPageProps {
  params: Promise<{ key: string }>;
}

export default async function BoardPage({ params }: Readonly<BoardPageProps>) {
  const { key } = await params;
  const { items, costRisk, error } = await fetchBoard(key);

  if (error) {
    return (
      <main
        data-testid="board-error"
        className="min-h-screen p-6 text-zinc-100 bg-zinc-950"
      >
        <h1 className="text-lg font-mono mb-2">Board unavailable</h1>
        <p className="text-sm text-zinc-400">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-zinc-100 bg-zinc-950 overflow-x-hidden">
      <RunOverviewBanners costRisk={costRisk} />
      <section data-testid="board-workspace-shell" data-selected-workspace={key}>
        <BoardWorkspaceView items={items ?? []} workspaceKey={key} />
      </section>
    </main>
  );
}
