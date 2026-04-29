"use client";

import type { ItemDetailDTO, ActionResult, ItemAction, ItemActionPayload } from "@/lib/engine/types";
import { ItemDetailHeader } from "./ItemDetailHeader";
import { ItemDetailToolbar } from "./ItemDetailToolbar";

type Props = {
  readonly item: ItemDetailDTO;
  readonly onAction: (action: ItemAction, payload?: ItemActionPayload) => Promise<ActionResult>;
};

export function ItemDetailView({ item, onAction }: Readonly<Props>): React.ReactElement {
  return (
    <div data-testid="item-detail-view" className="flex flex-col">
      <ItemDetailHeader
        itemCode={item.itemCode}
        title={item.title}
        phaseStatus={item.phase_status}
        currentStage={item.current_stage}
      />
      <ItemDetailToolbar
        allowedActions={item.allowedActions}
        onAction={onAction}
      />
    </div>
  );
}
