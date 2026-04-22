import { Button } from "@/components/primitives/Button";

export function ConversationComposer() {
  return (
    <div className="composer">
      <textarea rows={4} defaultValue="Initialize the directories first. Keep git changes explicit." />
      <Button variant="primary">Send input</Button>
    </div>
  );
}
