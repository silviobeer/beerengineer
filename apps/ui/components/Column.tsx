import type { Item, Phase } from "../lib/types";
import { ItemCard } from "./ItemCard";

interface ColumnProps {
  readonly phase: Phase;
  readonly items: Item[];
  readonly workspaceKey: string;
}

export function Column({ phase, items, workspaceKey }: Readonly<ColumnProps>) {
  return (
    <section
      data-testid="board-column"
      data-phase={phase}
      className="flex flex-col gap-2 min-w-[260px] flex-shrink-0 w-[260px] sm:w-auto sm:flex-1"
    >
      <h2
        data-testid="column-header"
        className="text-xs font-semibold uppercase tracking-widest text-zinc-300 px-1 py-2 border-b border-zinc-800"
      >
        {phase}
      </h2>
      <div className="flex flex-col gap-2 min-h-[40px]">
        {items.length === 0 ? (
          <div
            data-testid="column-empty"
            className="text-xs text-zinc-500 italic px-1 py-2"
          >
            No items
          </div>
        ) : (
          items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              workspaceKey={workspaceKey}
            />
          ))
        )}
      </div>
    </section>
  );
}
