import type { ItemOverlayViewModel } from "@/lib/view-models";
import { ItemActionList } from "@/components/overlay/ItemActionList";
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
        <ItemActionList actions={overlay.actions} />
        <ItemChatPreview messages={overlay.chatPreview} />
      </aside>
    </>
  );
}
