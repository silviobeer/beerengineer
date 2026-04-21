import type { ItemOverlayViewModel, ItemMode } from "@/lib/view-models";
import { AttentionIndicator } from "@/components/board/AttentionIndicator";
import { ModeIcon } from "@/components/board/BoardIcons";
import { MonoLabel } from "@/components/primitives/MonoLabel";

const modeTone: Record<ItemMode, string> = {
  auto: "petrol",
  assisted: "petrol",
  manual: "muted"
};

export function ItemOverlayHeader({ overlay }: { overlay: ItemOverlayViewModel }) {
  return (
    <div className="detail-head">
      <MonoLabel>{overlay.itemCode}</MonoLabel>
      <h2>{overlay.title}</h2>
      <p>{overlay.summary}</p>
      <div className="item-signals">
        <span className={`attention-signal ${modeTone[overlay.mode]}`} aria-label={`Mode: ${overlay.mode}`}>
          <ModeIcon mode={overlay.mode} />
          {overlay.mode}
        </span>
        <AttentionIndicator attention={overlay.attention} />
      </div>
    </div>
  );
}
