export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="state-card state-empty">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
