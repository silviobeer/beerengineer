import type { ProgressRowViewModel } from "@/lib/view-models";

export function ItemProgressRow({ row }: { row: ProgressRowViewModel }) {
  return (
    <div className="detail-row">
      <strong>{row.stage}</strong>
      <span>{row.status}</span>
      <p>{row.note}</p>
    </div>
  );
}
