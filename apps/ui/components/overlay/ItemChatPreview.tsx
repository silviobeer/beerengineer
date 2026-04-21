import type { ChatMessageViewModel } from "@/lib/view-models";

export function ItemChatPreview({ messages }: { messages: ChatMessageViewModel[] }) {
  return (
    <div className="detail-block">
      <h3>Chat preview</h3>
      <div className="chat-box">
        {messages.map((message, index) => (
          <div key={`${message.author}-${index}`} className={`chat-line ${message.role}`}>
            <strong>{message.author}</strong>
            <p>{message.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
