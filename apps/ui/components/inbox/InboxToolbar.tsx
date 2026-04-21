export function InboxToolbar({ filters }: { filters: string[] }) {
  return (
    <div className="filters">
      {filters.map((filter) => (
        <span key={filter} className="status-chip tone-neutral">
          {filter}
        </span>
      ))}
    </div>
  );
}
