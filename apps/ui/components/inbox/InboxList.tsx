import type { InboxRowViewModel } from "@/lib/view-models";
import { InboxRow } from "@/components/inbox/InboxRow";
import { Panel } from "@/components/primitives/Panel";

export function InboxList({ rows }: { rows: InboxRowViewModel[] }) {
  return (
    <Panel>
      {rows.map((row) => (
        <InboxRow key={row.title} row={row} />
      ))}
    </Panel>
  );
}
