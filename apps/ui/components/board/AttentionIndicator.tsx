import type { AttentionState } from "@/lib/view-models";

export function AttentionIndicator({ attention }: { attention: AttentionState }) {
  return (
    <span aria-label="Attention" className={`attention-pill attention-${attention}`}>
      {attention}
    </span>
  );
}
