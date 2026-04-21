import { BoardView } from "@/components/board/BoardView";
import { ItemOverlay } from "@/components/overlay/ItemOverlay";
import { AppShell } from "@/components/shell/AppShell";
import { boardViewModel, overlayViewModel, shellViewModel } from "@/lib/mock-data";

export default function BoardPage() {
  return (
    <AppShell shell={shellViewModel} activeHref="/">
      <div className="canvas">
        <BoardView board={boardViewModel} />
        <ItemOverlay overlay={overlayViewModel} />
      </div>
    </AppShell>
  );
}
