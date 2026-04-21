import type { ProgressRowViewModel } from "@/lib/view-models";

export function ItemProgressRow({ row }: { row: ProgressRowViewModel }) {
  const note = row.status ? `${row.status} · ${row.note}` : row.note;
  return (
    <div className="detail-row">
      <strong>{row.stage}</strong>
      <p>{note}</p>
    </div>
  );
}
