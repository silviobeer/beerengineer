import type { BranchRowViewModel } from "@/lib/view-models";
import { BranchRow } from "@/components/primitives/BranchRow";
import { DetailBlock } from "@/components/primitives/DetailBlock";

export function ItemBranchList({ branches }: { branches: BranchRowViewModel[] }) {
  if (branches.length === 0) return null;
  return (
    <DetailBlock kicker="Branches" title="Branch state">
      <div className="detail-list branch-list">
        {branches.map((branch, index) => (
          <BranchRow key={`${branch.scope}-${branch.name}-${index}`} branch={branch} />
        ))}
      </div>
    </DetailBlock>
  );
}
