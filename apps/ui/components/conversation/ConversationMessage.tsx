import type { ChatMessageViewModel } from "@/lib/view-models";

export function ConversationMessage({ message }: { message: ChatMessageViewModel }) {
  return (
    <div className={`chat-line ${message.role}`}>
      <strong>{message.author}</strong>
      <p>{message.message}</p>
    </div>
  );
}
