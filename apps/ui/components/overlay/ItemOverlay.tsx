import type { ItemOverlayViewModel } from "@/lib/view-models";
import { ItemActionList } from "@/components/overlay/ItemActionList";
import { ItemBoardActions } from "@/components/overlay/ItemBoardActions";
import { ItemBranchList } from "@/components/overlay/ItemBranchList";
import { ItemChatPreview } from "@/components/overlay/ItemChatPreview";
import { ItemMergePanel } from "@/components/overlay/ItemMergePanel";
import { ItemOverlayHeader } from "@/components/overlay/ItemOverlayHeader";
import { ItemPreviewCard } from "@/components/overlay/ItemPreviewCard";
import { ItemProgressList } from "@/components/overlay/ItemProgressList";
import { ItemQuickPrompt } from "@/components/overlay/ItemQuickPrompt";
import { ItemRunSummary } from "@/components/overlay/ItemRunSummary";
import { ItemTree } from "@/components/overlay/ItemTree";

export function ItemOverlay({ overlay }: { overlay: ItemOverlayViewModel }) {
  return (
    <>
      <div className="overlay-scrim" />
      <aside className="overlay-panel" aria-label={`Item ${overlay.itemCode} detail`}>
        <ItemOverlayHeader overlay={overlay} />
        <ItemQuickPrompt prompt={overlay.openPrompt} />
        <ItemRunSummary overlay={overlay} />
        <ItemBranchList branches={overlay.branches ?? []} />
        <ItemTree nodes={overlay.tree ?? []} />
        <ItemProgressList rows={overlay.progress} />
        {overlay.itemId && overlay.currentColumn && overlay.currentPhase ? (
          <ItemBoardActions
            itemId={overlay.itemId}
            latestRunId={overlay.runSummary?.runId ?? null}
            column={overlay.currentColumn}
            phase={overlay.currentPhase}
          />
        ) : null}
        <ItemActionList actions={overlay.actions} />
        <ItemMergePanel merge={overlay.merge} />
        <ItemPreviewCard preview={overlay.preview} />
        <ItemChatPreview messages={overlay.chatPreview} />
      </aside>
    </>
  );
}
