import { Button } from "@/components/primitives/Button";

export function ConversationActionBar() {
  return (
    <div className="detail-actions compact">
      <Button variant="default">Approve</Button>
      <Button variant="default">Retry</Button>
      <Button variant="primary">Request changes</Button>
    </div>
  );
}
