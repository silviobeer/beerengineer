export function LoadingState({ label }: { label: string }) {
  return (
    <div className="state-card state-loading">
      <strong>{label}</strong>
      <div className="loading-bars">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
