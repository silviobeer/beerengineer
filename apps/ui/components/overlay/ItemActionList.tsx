import type { ActionViewModel } from "@/lib/view-models";
import { ArrowRightIcon, CheckIcon, InboxIcon } from "@/components/board/BoardIcons";
import { MonoLabel } from "@/components/primitives/MonoLabel";

function iconForAction(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("chat") || lower.includes("message") || lower.includes("reply")) {
    return <InboxIcon />;
  }
  if (lower.includes("approve") || lower.includes("accept") || lower.includes("confirm") || lower.includes("done")) {
    return <CheckIcon />;
  }
  return <ArrowRightIcon />;
}

export function ItemActionList({ actions }: { actions: ActionViewModel[] }) {
  return (
    <div className="detail-block">
      <MonoLabel>Actions</MonoLabel>
      <h3>Next actions</h3>
      <div className="detail-actions">
        {actions.map((action) => (
          <span
            key={action.label}
            className={action.primary ? "detail-action primary" : "detail-action"}
            title={action.detail}
          >
            {iconForAction(action.label)}
            {action.label}
          </span>
        ))}
      </div>
    </div>
  );
}
