import type { ChatMessageViewModel } from "@/lib/view-models";
import { ConversationMessage } from "@/components/conversation/ConversationMessage";

export function ConversationMessageList({ messages }: { messages: ChatMessageViewModel[] }) {
  return (
    <div className="chat-box">
      {messages.map((message, index) => (
        <ConversationMessage key={`${message.author}-${index}`} message={message} />
      ))}
    </div>
  );
}
