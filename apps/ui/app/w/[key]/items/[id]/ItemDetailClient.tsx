"use client";

import { useCallback } from "react";
import type { ItemDetailDTO, ActionResult, ItemAction } from "@/lib/engine/types";
import { ItemDetailView } from "@/components/itemDetail/ItemDetailView";
import { performItemAction } from "./actions";

export function ItemDetailClient({ item }: Readonly<{ item: ItemDetailDTO }>): React.ReactElement {
  const onAction = useCallback(
    async (action: ItemAction): Promise<ActionResult> => {
      return performItemAction(item.itemId, action);
    },
    [item.itemId],
  );
  return <ItemDetailView item={item} onAction={onAction} />;
}
