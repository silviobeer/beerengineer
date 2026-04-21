import type { CardMeta } from "@/lib/view-models";

export function CardMetaRow({ meta }: { meta: CardMeta[] }) {
  return (
    <div className="card-meta-row">
      {meta.map((entry) => (
        <span key={`${entry.label}-${entry.value}`}>
          <strong>{entry.value}</strong>
          <small>{entry.label}</small>
        </span>
      ))}
    </div>
  );
}
