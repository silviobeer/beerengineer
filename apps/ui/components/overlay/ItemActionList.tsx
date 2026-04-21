import type { ActionViewModel } from "@/lib/view-models";
import { Button } from "@/components/primitives/Button";

export function ItemActionList({ actions }: { actions: ActionViewModel[] }) {
  return (
    <div className="detail-block">
      <h3>Next actions</h3>
      <div className="detail-actions">
        {actions.map((action) => (
          <div key={action.label} className="detail-action-card">
            <Button variant={action.primary ? "primary" : "default"}>{action.label}</Button>
            <p>{action.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
