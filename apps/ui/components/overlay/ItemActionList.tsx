import Link from "next/link";
import type { ActionViewModel } from "@/lib/view-models";
import { ArrowRightIcon, CheckIcon, InboxIcon } from "@/components/board/BoardIcons";
import { DetailBlock } from "@/components/primitives/DetailBlock";

function iconForAction(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("chat") || lower.includes("message") || lower.includes("reply") || lower.includes("prompt")) {
    return <InboxIcon />;
  }
  if (lower.includes("approve") || lower.includes("accept") || lower.includes("confirm") || lower.includes("done")) {
    return <CheckIcon />;
  }
  return <ArrowRightIcon />;
}

export function ItemActionList({ actions }: { actions: ActionViewModel[] }) {
  return (
    <DetailBlock kicker="Actions" title="Next actions">
      <div className="detail-actions">
        {actions.map((action) => {
          const className = action.primary ? "detail-action primary" : "detail-action";
          if (action.href) {
            return (
              <Link key={action.label} href={action.href} className={className} title={action.detail}>
                {iconForAction(action.label)}
                {action.label}
              </Link>
            );
          }
          return (
            <span
              key={action.label}
              className={className}
              title={action.detail}
              aria-disabled="true"
            >
              {iconForAction(action.label)}
              {action.label}
            </span>
          );
        })}
      </div>
    </DetailBlock>
  );
}
