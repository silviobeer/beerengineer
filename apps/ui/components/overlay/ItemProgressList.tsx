import type { ProgressRowViewModel } from "@/lib/view-models";
import { ItemProgressRow } from "@/components/overlay/ItemProgressRow";

export function ItemProgressList({ rows }: { rows: ProgressRowViewModel[] }) {
  return (
    <div className="detail-block">
      <h3>Progress</h3>
      <div className="detail-list">
        {rows.map((row) => (
          <ItemProgressRow key={row.stage} row={row} />
        ))}
      </div>
    </div>
  );
}
