import ItemDetail from "../../../../../components/ItemDetail";
import { OverlayModal } from "@/components/OverlayModal";
import type { WorkspaceItem } from "../../../../../lib/types";

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

async function loadItem(itemId: string): Promise<WorkspaceItem | null> {
  try {
    const res = await fetch(`${ENGINE_URL}/items/${encodeURIComponent(itemId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceItem;
  } catch {
    return null;
  }
}

/**
 * Intercepting variant of /w/[key]/items/[id]. When the user clicks a
 * board card, this route catches the navigation and renders the detail
 * inside an overlay on top of the board. Direct URL access (refresh,
 * paste) falls through to the non-intercepting page at
 * app/w/[key]/items/[id]/page.tsx.
 */
export default async function ItemDetailModal({
  params,
}: {
  params: Promise<{ key: string; id: string }>;
}) {
  const { key, id } = await params;
  const [items, item] = await Promise.all([loadItems(key), loadItem(id)]);
  const ariaLabel = item?.title ? `Item: ${item.title}` : "Item detail";
  return (
    <OverlayModal ariaLabel={ariaLabel}>
      <ItemDetail workspaceKey={key} itemId={id} items={items} item={item} />
    </OverlayModal>
  );
}
