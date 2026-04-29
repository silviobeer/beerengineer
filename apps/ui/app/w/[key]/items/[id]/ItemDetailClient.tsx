"use client";

import { useCallback } from "react";
import type { ItemDetailDTO, ActionResult, ItemAction, ItemActionPayload } from "@/lib/engine/types";
import { ItemDetailView } from "@/components/itemDetail/ItemDetailView";
import { performItemAction } from "./actions";

export function ItemDetailClient({ item }: Readonly<{ item: ItemDetailDTO }>): React.ReactElement {
  const onAction = useCallback(
    async (action: ItemAction, payload?: ItemActionPayload): Promise<ActionResult> => {
      return performItemAction(item.itemId, action, payload);
    },
    [item.itemId],
  );
  return <ItemDetailView item={item} onAction={onAction} />;
}
