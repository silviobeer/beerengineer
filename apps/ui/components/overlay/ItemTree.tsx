import type { ItemTreeNode } from "@/lib/view-models";
import { DetailBlock } from "@/components/primitives/DetailBlock";
import { DisclosureRow } from "@/components/primitives/DisclosureRow";

function renderNode(node: ItemTreeNode): React.ReactNode {
  return (
    <DisclosureRow
      key={node.id}
      label={
        <span className="tree-node-label">
          <span className="mono-label">{node.kind}</span>
          <strong>{node.label}</strong>
        </span>
      }
      meta={
        <span className="tree-node-meta">
          {node.status ? <span>{node.status}</span> : null}
          {node.branch ? <code>{node.branch}</code> : null}
        </span>
      }
    >
      {node.children && node.children.length > 0
        ? <div className="tree-children">{node.children.map(renderNode)}</div>
        : null}
    </DisclosureRow>
  );
}

export function ItemTree({ nodes }: { nodes: ItemTreeNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <DetailBlock kicker="Projects · stories" title="Item hierarchy">
      <div className="detail-list tree-list">{nodes.map(renderNode)}</div>
    </DetailBlock>
  );
}
