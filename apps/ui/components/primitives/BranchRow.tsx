import type { BranchRowViewModel, SignalTone } from "@/lib/view-models";
import { ListRow } from "@/components/primitives/ListRow";
import { StatusChip } from "@/components/primitives/StatusChip";

const statusTone: Record<BranchRowViewModel["status"], SignalTone> = {
  active: "petrol",
  merged: "success",
  open_candidate: "gold",
  abandoned: "neutral"
};

const statusLabel: Record<BranchRowViewModel["status"], string> = {
  active: "active",
  merged: "merged",
  open_candidate: "candidate",
  abandoned: "abandoned"
};

const scopeLabel: Record<BranchRowViewModel["scope"], string> = {
  main: "main",
  project: "project",
  story: "story",
  candidate: "candidate"
};

export function BranchRow({ branch }: { branch: BranchRowViewModel }) {
  return (
    <ListRow>
      <div className="branch-row" data-scope={branch.scope}>
        <span className="mono-label">{scopeLabel[branch.scope]}</span>
        <code className="branch-name" title={branch.base ? `base: ${branch.base}` : undefined}>
          {branch.name}
        </code>
        {branch.detail ? <span className="branch-detail">{branch.detail}</span> : null}
        <StatusChip label={statusLabel[branch.status]} tone={statusTone[branch.status]} />
      </div>
    </ListRow>
  );
}
