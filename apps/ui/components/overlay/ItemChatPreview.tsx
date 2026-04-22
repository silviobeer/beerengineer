import type { ChatMessageViewModel } from "@/lib/view-models";
import { ConversationMessage } from "@/components/conversation/ConversationMessage";
import { DetailBlock } from "@/components/primitives/DetailBlock";

export function ItemChatPreview({ messages }: { messages: ChatMessageViewModel[] }) {
  return (
    <DetailBlock kicker="Chat peek" title="Latest exchange">
      <div className="chat-box">
        {messages.map((message, index) => (
          <ConversationMessage key={`${message.author}-${index}`} message={message} />
        ))}
      </div>
    </DetailBlock>
  );
}
