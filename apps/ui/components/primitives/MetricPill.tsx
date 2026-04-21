export function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="metric-pill">
      <strong>{value}</strong>
      <span>{label}</span>
    </span>
  );
}
