import Board from "../../components/Board";
import type { WorkspaceItem } from "../../lib/types";

const ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ?? process.env.ENGINE_URL ?? "http://localhost:4100";

async function loadItems(workspaceKey: string): Promise<WorkspaceItem[]> {
  try {
    const res = await fetch(`${ENGINE_URL}/items?workspace=${encodeURIComponent(workspaceKey)}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: WorkspaceItem[] };
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const items = await loadItems(key);
  return <Board workspaceKey={key} items={items} />;
}
