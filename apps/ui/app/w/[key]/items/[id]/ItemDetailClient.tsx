"use client";

import { useCallback } from "react";
import type { ItemDetailDTO, ActionResult, ItemAction } from "../../../../_engine/types";
import { ItemDetailView } from "../../../../_ui/ItemDetailView";
import { performItemAction } from "./actions";

export function ItemDetailClient({ item }: { item: ItemDetailDTO }): React.ReactElement {
  const onAction = useCallback(
    async (action: ItemAction): Promise<ActionResult> => {
      return performItemAction(item.itemId, action);
    },
    [item.itemId],
  );
  return <ItemDetailView item={item} onAction={onAction} />;
}
