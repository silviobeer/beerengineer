import type { ProgressRowViewModel } from "@/lib/view-models";
import { DetailBlock } from "@/components/primitives/DetailBlock";
import { ItemProgressRow } from "@/components/overlay/ItemProgressRow";

export function ItemProgressList({ rows }: { rows: ProgressRowViewModel[] }) {
  return (
    <DetailBlock kicker="Workflow ladder" title="Implementation stages">
      <div className="detail-list">
        {rows.map((row) => (
          <ItemProgressRow key={row.stage} row={row} />
        ))}
      </div>
    </DetailBlock>
  );
}
