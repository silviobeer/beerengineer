import type { ItemOverlayViewModel } from "@/lib/view-models";
import { AttentionIndicator } from "@/components/board/AttentionIndicator";
import { BoardCardModeIcon } from "@/components/board/BoardCardModeIcon";
import { MonoLabel } from "@/components/primitives/MonoLabel";

export function ItemOverlayHeader({ overlay }: { overlay: ItemOverlayViewModel }) {
  return (
    <div className="detail-head">
      <MonoLabel>{overlay.itemCode}</MonoLabel>
      <h2>{overlay.title}</h2>
      <p>{overlay.summary}</p>
      <div className="detail-mode-row">
        <BoardCardModeIcon mode={overlay.mode} />
        <AttentionIndicator attention={overlay.attention} />
      </div>
    </div>
  );
}
