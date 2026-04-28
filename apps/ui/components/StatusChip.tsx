import { deriveStatusLabel } from "../lib/statusLabel";

interface StatusChipProps {
  state: string;
  currentStage?: string | null;
}

export function StatusChip({ state, currentStage }: Readonly<StatusChipProps>) {
  const label = deriveStatusLabel(state, currentStage ?? null);
  return (
    <span
      data-testid="status-chip"
      data-state={state}
      data-label={label}
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium border border-zinc-700 bg-zinc-800/60 text-zinc-200"
    >
      {label}
    </span>
  );
}
