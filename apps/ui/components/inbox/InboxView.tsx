import type { InboxViewModel } from "@/lib/view-models";
import { InboxList } from "@/components/inbox/InboxList";
import { InboxToolbar } from "@/components/inbox/InboxToolbar";
import { MonoLabel } from "@/components/primitives/MonoLabel";

export function InboxView({ inbox }: { inbox: InboxViewModel }) {
  return (
    <section className="stack-panel">
      <div className="board-head">
        <div>
          <MonoLabel>Workspace inbox</MonoLabel>
          <h2>{inbox.heading}</h2>
          <p>{inbox.description}</p>
        </div>
      </div>
      <InboxToolbar filters={inbox.filters} />
      <InboxList rows={inbox.rows} />
    </section>
  );
}
