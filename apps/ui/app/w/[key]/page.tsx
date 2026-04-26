import { Board } from "@/components/Board";
import type { BoardCardDTO } from "@/lib/types";

interface BoardApiItem {
  id?: string;
  itemCode?: string;
  title?: string;
  summary?: string | null;
  phase?: string;
  column?: string;
  phase_status?: string | null;
  hasOpenPrompt?: boolean;
  hasReviewGateWaiting?: boolean;
  hasBlockedRun?: boolean;
  current_stage?: string | null;
}

interface BoardApiResponse {
  items?: BoardApiItem[];
}

function engineUrl(): string {
  const url =
    process.env.ENGINE_URL ||
    process.env.NEXT_PUBLIC_ENGINE_URL ||
    "http://127.0.0.1:4100";
  return url.replace(/\/$/, "");
}

function toBoardCard(item: BoardApiItem): BoardCardDTO {
  const id = item.id ?? item.itemCode ?? "";
  return {
    id,
    itemCode: item.itemCode,
    title: item.title ?? "",
    summary: item.summary ?? null,
    column: item.phase ?? item.column ?? "idea",
    phase_status: item.phase_status ?? null,
    hasOpenPrompt: Boolean(item.hasOpenPrompt),
    hasReviewGateWaiting: Boolean(item.hasReviewGateWaiting),
    hasBlockedRun: Boolean(item.hasBlockedRun),
    current_stage: item.current_stage ?? null,
  };
}

async function fetchBoard(
  workspaceKey: string
): Promise<{ items: BoardCardDTO[] | null; error: string | null }> {
  try {
    const res = await fetch(
      `${engineUrl()}/board?workspace=${encodeURIComponent(workspaceKey)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return { items: null, error: `engine responded ${res.status}` };
    }
    const data = (await res.json()) as BoardApiResponse;
    const items = Array.isArray(data.items) ? data.items.map(toBoardCard) : [];
    return { items, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return { items: null, error: message };
  }
}

interface BoardPageProps {
  params: Promise<{ key: string }>;
}

export default async function BoardPage({ params }: BoardPageProps) {
  const { key } = await params;
  const { items, error } = await fetchBoard(key);

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
      <Board items={items ?? []} workspaceKey={key} />
    </main>
  );
}
