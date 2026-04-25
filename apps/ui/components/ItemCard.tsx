import Link from "next/link";
import type { Item } from "../lib/types";
import { hasAttentionDot } from "../lib/attention";
import { StatusChip } from "./StatusChip";
import { AttentionDot } from "./AttentionDot";
import { MiniStepper } from "./MiniStepper";

interface ItemCardProps {
  item: Item;
  workspaceKey: string;
}

export function ItemCard({ item, workspaceKey }: ItemCardProps) {
  const showAttention = hasAttentionDot(item);
  const showStepper = item.phase === "Implementation";
  const summary = item.summary && item.summary.length > 0 ? item.summary : null;

  return (
    <Link
      href={`/w/${workspaceKey}/items/${item.id}`}
      data-testid="item-card"
      data-item-id={item.id}
      className="block border border-zinc-800 bg-zinc-900/60 p-3 hover:bg-zinc-900 focus:outline focus:outline-1 focus:outline-zinc-500"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          data-testid="item-code"
          className="font-mono text-xs text-zinc-400"
        >
          {item.itemCode}
        </span>
        {showAttention ? <AttentionDot /> : null}
      </div>
      <div
        data-testid="item-title"
        className="mt-1 text-sm text-zinc-100 break-words"
      >
        {item.title}
      </div>
      {summary !== null ? (
        <p
          data-testid="item-summary"
          className="mt-1 text-xs text-zinc-400 break-words"
        >
          {summary}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <StatusChip state={item.pipelineState} />
      </div>
      {showStepper ? <MiniStepper pipelineState={item.pipelineState} /> : null}
    </Link>
  );
}
