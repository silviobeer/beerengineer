import { StatusChip } from "@/components/primitives/StatusChip";

export function InboxToolbar({ filters }: { filters: string[] }) {
  return (
    <div className="filters">
      {filters.map((filter) => (
        <StatusChip key={filter} label={filter} />
      ))}
    </div>
  );
}
