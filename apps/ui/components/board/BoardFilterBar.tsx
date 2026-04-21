import type { BoardViewModel } from "@/lib/view-models";
import { StatusChip } from "@/components/primitives/StatusChip";

export function BoardFilterBar({ filters }: Pick<BoardViewModel, "filters">) {
  return (
    <div className="filters">
      {filters.map((filter) => (
        <StatusChip key={filter.label} label={filter.label} tone={filter.tone} />
      ))}
    </div>
  );
}
