import type { ProgressRowViewModel } from "@/lib/view-models";

const markerSymbol: Record<NonNullable<ProgressRowViewModel["marker"]>, string> = {
  current: "●",
  complete: "✓",
  failed: "✕",
  skipped: "–",
  pending: "○"
};

export function ItemProgressRow({ row }: { row: ProgressRowViewModel }) {
  const note = row.status && !row.note ? row.status : row.note;
  const marker = row.marker ?? "pending";
  return (
    <div className="detail-row" data-marker={marker}>
      <span className={`progress-marker marker-${marker}`} aria-hidden="true">
        {markerSymbol[marker]}
      </span>
      <strong>{row.stage}</strong>
      <p>{note}</p>
    </div>
  );
}
