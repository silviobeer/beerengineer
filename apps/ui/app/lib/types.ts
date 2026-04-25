export type WorkspaceItem = {
  id: string;
  itemCode?: string;
  title: string;
  summary?: string;
  attentionDot: boolean;
  phaseStatus?: string;
  currentColumn?: string;
  currentStage?: string;
};

export function countAttention(items: readonly WorkspaceItem[] | undefined | null): number {
  if (!items) return 0;
  let count = 0;
  for (const item of items) {
    if (item.attentionDot) count += 1;
  }
  return count;
}
