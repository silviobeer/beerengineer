import { StatusChip } from "./StatusChip";

export type WaveRowDbRelevance = {
  value: boolean
  source: "explicit" | "override" | "detector"
  reason?: string
}

export function WaveRow({
  title,
  dbRelevance,
}: Readonly<{ title: string; dbRelevance: WaveRowDbRelevance }>) {
  const label = dbRelevance.value ? "DB" : "non-DB";
  const tooltip = `${dbRelevance.source}${dbRelevance.reason ? `: ${dbRelevance.reason}` : ""}`;
  return (
    <div className="flex items-center justify-between gap-3 border border-zinc-800 bg-zinc-950 p-3" data-testid="wave-row">
      <span className="min-w-0 text-sm text-zinc-100">{title}</span>
      <span title={tooltip} aria-label={`DB relevance ${tooltip}`}>
        <StatusChip state={label} />
      </span>
    </div>
  );
}
