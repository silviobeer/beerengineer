import { InboxView } from "@/components/inbox/InboxView";
import { AppShell } from "@/components/shell/AppShell";
import { ErrorState } from "@/components/primitives/ErrorState";
import { buildInboxShell, getLiveInboxState } from "@/lib/live-inbox";
import { inboxViewModel, shellViewModel } from "@/lib/mock-legacy-data";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams
}: {
  searchParams?: Promise<{ workspace?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const state = getLiveInboxState(params?.workspace ?? null);

  if (state.kind === "fallback") {
    return (
      <AppShell shell={shellViewModel} activeHref="/inbox" workspaceHrefBase="/inbox">
        <InboxView inbox={inboxViewModel} />
        <ErrorState title="Live inbox unavailable" detail={state.reason} />
      </AppShell>
    );
  }

  const counts = {
    prompts: state.inbox.rows.filter((r) => r.kind === "prompt_waiting").length,
    blocked: state.inbox.rows.filter((r) => r.kind === "blocked_run" || r.kind === "failed_run").length,
    review: state.inbox.rows.filter((r) => r.kind === "review_required").length
  };

  const shell = buildInboxShell(state.activeWorkspace, state.workspaces, counts);

  return (
    <AppShell shell={shell} activeHref="/inbox" workspaceHrefBase="/inbox">
      <InboxView inbox={state.inbox} />
    </AppShell>
  );
}
