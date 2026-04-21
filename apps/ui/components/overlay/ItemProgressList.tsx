import type { ProgressRowViewModel } from "@/lib/view-models";
import { MonoLabel } from "@/components/primitives/MonoLabel";
import { ItemProgressRow } from "@/components/overlay/ItemProgressRow";

export function ItemProgressList({ rows }: { rows: ProgressRowViewModel[] }) {
  return (
    <div className="detail-block">
      <MonoLabel>Progress</MonoLabel>
      <h3>Current progression</h3>
      <div className="detail-list">
        {rows.map((row) => (
          <ItemProgressRow key={row.stage} row={row} />
        ))}
      </div>
    </div>
  );
}
