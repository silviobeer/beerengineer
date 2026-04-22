import type { ItemOverlayViewModel } from "@/lib/view-models";
import { ItemActionList } from "@/components/overlay/ItemActionList";
import { ItemBoardActions } from "@/components/overlay/ItemBoardActions";
import { ItemChatPreview } from "@/components/overlay/ItemChatPreview";
import { ItemOverlayHeader } from "@/components/overlay/ItemOverlayHeader";
import { ItemProgressList } from "@/components/overlay/ItemProgressList";

export function ItemOverlay({ overlay }: { overlay: ItemOverlayViewModel }) {
  return (
    <>
      <div className="overlay-scrim" />
      <aside className="overlay-panel">
        <ItemOverlayHeader overlay={overlay} />
        <ItemProgressList rows={overlay.progress} />
        {overlay.itemId && overlay.currentColumn && overlay.currentPhase ? (
          <ItemBoardActions
            itemId={overlay.itemId}
            column={overlay.currentColumn}
            phase={overlay.currentPhase}
          />
        ) : null}
        <ItemActionList actions={overlay.actions} />
        <ItemChatPreview messages={overlay.chatPreview} />
      </aside>
    </>
  );
}
