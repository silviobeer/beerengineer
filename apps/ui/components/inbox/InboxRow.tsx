import type { InboxRowViewModel } from "@/lib/view-models";
import { Button } from "@/components/primitives/Button";
import { ListRow } from "@/components/primitives/ListRow";
import { PriorityMarker } from "@/components/inbox/PriorityMarker";

export function InboxRow({ row }: { row: InboxRowViewModel }) {
  return (
    <ListRow>
      <div className="inbox-row">
        <div className="inbox-main">
          <div className="inbox-labels">
            <PriorityMarker priority={row.priority} />
            <span className="inbox-kind">{row.kind}</span>
          </div>
          <strong>{row.title}</strong>
          <p>{row.detail}</p>
        </div>
        <div className="inbox-side">
          <span className="inbox-status">{row.status}</span>
          <Button variant="primary">{row.primaryAction}</Button>
        </div>
      </div>
    </ListRow>
  );
}
