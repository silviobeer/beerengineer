import { BoardColumn } from "@/components/board/BoardColumn";
import { BoardCard } from "@/components/board/BoardCard";
import { ConversationView } from "@/components/conversation/ConversationView";
import { InboxRow } from "@/components/inbox/InboxRow";
import { ItemOverlay } from "@/components/overlay/ItemOverlay";
import { EmptyState } from "@/components/primitives/EmptyState";
import { ErrorState } from "@/components/primitives/ErrorState";
import { LoadingState } from "@/components/primitives/LoadingState";
import { Panel } from "@/components/primitives/Panel";
import { SectionTitle } from "@/components/primitives/SectionTitle";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { GlobalSignals } from "@/components/shell/GlobalSignals";
import { PrimaryNav } from "@/components/shell/PrimaryNav";
import {
  boardViewModel,
  conversationMessages,
  inboxViewModel,
  overlayViewModel,
  shellViewModel
} from "@/lib/mock-legacy-data";
import { AppShell } from "@/components/shell/AppShell";
import { defaultWorkspaceKey, getWorkspaceBoardState } from "@/lib/mock-data";

export default function ShowcasePage() {
  const workspaceShell = getWorkspaceBoardState(defaultWorkspaceKey).shell;

  return (
    <AppShell shell={shellViewModel} activeHref="/showcase">
      <div className="showcase-page">
        <Panel className="padded">
          <SectionTitle title="Shell components" description="Persistent chrome and top-level signals." />
          <div className="showcase-grid three">
            <WorkspaceSwitcher workspace={workspaceShell.activeWorkspace} workspaces={workspaceShell.availableWorkspaces} />
            <PrimaryNav items={shellViewModel.navItems} activeHref="/" />
            <GlobalSignals signals={shellViewModel.globalSignals} />
          </div>
        </Panel>

        <Panel className="padded">
          <SectionTitle title="Board components" description="Cards and columns in realistic states." />
          <div className="showcase-grid three">
            {boardViewModel.columns.slice(0, 3).map((column) => (
              <BoardColumn key={column.key} column={column} />
            ))}
          </div>
          <div className="showcase-grid three compact-top">
            {boardViewModel.columns.flatMap((column) => column.cards).slice(0, 3).map((card) => (
              <BoardCard key={card.itemCode} card={card} />
            ))}
          </div>
        </Panel>

        <Panel className="padded">
          <SectionTitle title="Overlay and inbox" description="Detail and inbox states without navigating the full app." />
          <div className="showcase-grid two">
            <div className="showcase-overlay">
              <ItemOverlay overlay={overlayViewModel} />
            </div>
            <div className="panel padded">
              {inboxViewModel.rows.map((row) => (
                <InboxRow key={row.title} row={row} />
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="padded">
          <SectionTitle title="Conversation and states" description="Shared dialog surface plus empty, loading and error variants." />
          <div className="showcase-grid two">
            <ConversationView messages={conversationMessages} />
            <div className="stack-panel">
              <EmptyState title="No selection" detail="Pick an item to open the overlay and inspect next actions." />
              <LoadingState label="Loading workspaces" />
              <ErrorState title="Workspace root blocked" detail="Repair the root path before setup actions can proceed." />
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
