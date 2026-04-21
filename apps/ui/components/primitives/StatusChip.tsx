import type { SignalTone } from "@/lib/view-models";

export function StatusChip({ label, tone = "neutral" }: { label: string; tone?: SignalTone }) {
  return <span className={`status-chip tone-${tone}`}>{label}</span>;
}
