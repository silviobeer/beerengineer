import type { ChatMessageViewModel } from "@/lib/view-models";
import { MonoLabel } from "@/components/primitives/MonoLabel";

export function ItemChatPreview({ messages }: { messages: ChatMessageViewModel[] }) {
  return (
    <div className="detail-block">
      <MonoLabel>Chat peek</MonoLabel>
      <h3>Latest exchange</h3>
      <div className="chat-box">
        {messages.map((message, index) => (
          <div key={`${message.author}-${index}`} className={`chat-line ${message.role}`}>
            <MonoLabel>{message.author}</MonoLabel>
            <p>{message.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
