import { BoardView } from "@/components/board/BoardView";
import { ItemOverlay } from "@/components/overlay/ItemOverlay";
import { EmptyState } from "@/components/primitives/EmptyState";
import { ErrorState } from "@/components/primitives/ErrorState";
import { AppShell } from "@/components/shell/AppShell";
import { getLiveBoardState } from "@/lib/live-board";

export default async function BoardPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const state = getLiveBoardState(params?.workspace ?? null);

  return (
    <AppShell shell={state.shell} activeHref="/" workspaceHrefBase="/">
      <div className="canvas">
        {state.kind === "ready" ? (
          <>
            <BoardView board={state.board} />
            <ItemOverlay overlay={state.overlay} />
          </>
        ) : state.kind === "empty" ? (
          <EmptyState title={state.title} detail={state.detail} />
        ) : (
          <ErrorState title={state.title} detail={state.detail} />
        )}
      </div>
    </AppShell>
  );
}
