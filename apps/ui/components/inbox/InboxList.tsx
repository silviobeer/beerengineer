import type { InboxRowViewModel } from "@/lib/view-models";
import { InboxRow } from "@/components/inbox/InboxRow";

export function InboxList({ rows }: { rows: InboxRowViewModel[] }) {
  return (
    <div className="panel">
      {rows.map((row) => (
        <InboxRow key={row.title} row={row} />
      ))}
    </div>
  );
}
