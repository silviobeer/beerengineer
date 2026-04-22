import { BoardView } from "@/components/board/BoardView";
import { BoardLiveSubscriber } from "@/components/board/BoardLiveSubscriber";
import { ItemOverlay } from "@/components/overlay/ItemOverlay";
import { EmptyState } from "@/components/primitives/EmptyState";
import { ErrorState } from "@/components/primitives/ErrorState";
import { AppShell } from "@/components/shell/AppShell";
import { getLiveBoardState } from "@/lib/live-board";

export default async function BoardPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string; item?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const state = getLiveBoardState(params?.workspace ?? null, params?.item ?? null);

  return (
    <AppShell shell={state.shell} activeHref="/" workspaceHrefBase="/">
      <div className="canvas">
        <BoardLiveSubscriber workspaceKey={params?.workspace ?? null} />
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
