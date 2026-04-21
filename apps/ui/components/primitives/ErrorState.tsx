export function ErrorState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="state-card state-error">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
