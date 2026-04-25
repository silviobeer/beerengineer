interface StatusChipProps {
  state: string;
}

export function StatusChip({ state }: StatusChipProps) {
  return (
    <span
      data-testid="status-chip"
      data-state={state}
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium border border-zinc-700 bg-zinc-800/60 text-zinc-200"
    >
      {state}
    </span>
  );
}
