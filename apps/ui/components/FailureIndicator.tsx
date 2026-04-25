export function FailureIndicator() {
  return (
    <span
      data-testid="failure-indicator"
      aria-label="Run failed"
      className="inline-block h-2 w-2 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
    />
  );
}
