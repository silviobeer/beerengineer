import { statusChipText } from "@/lib/statusChip";

type Props = {
  readonly itemCode: string;
  readonly title: string;
  readonly phaseStatus: string;
  readonly currentStage: string | null;
};

export function ItemDetailHeader({
  itemCode,
  title,
  phaseStatus,
  currentStage,
}: Readonly<Props>): React.ReactElement {
  const chip = statusChipText(phaseStatus, currentStage);
  return (
    <header
      role="banner"
      aria-label="Item detail header"
      className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3"
    >
      <span
        data-testid="item-code"
        style={{ fontFamily: "ui-monospace, Menlo, Monaco, Consolas, monospace" }}
        className="text-sm font-medium text-zinc-300"
      >
        {itemCode}
      </span>
      <h1 className="text-base font-semibold text-zinc-100">{title}</h1>
      <span
        data-testid="status-chip"
        className="ml-auto inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200"
      >
        {chip}
      </span>
    </header>
  );
}
