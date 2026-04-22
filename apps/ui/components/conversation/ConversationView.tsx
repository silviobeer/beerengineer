import type { ChatMessageViewModel } from "@/lib/view-models";
import { ConversationActionBar } from "@/components/conversation/ConversationActionBar";
import { ConversationComposer } from "@/components/conversation/ConversationComposer";
import { ConversationMessageList } from "@/components/conversation/ConversationMessageList";
import { DetailBlock } from "@/components/primitives/DetailBlock";

export function ConversationView({ messages }: { messages: ChatMessageViewModel[] }) {
  return (
    <section className="stack-panel">
      <DetailBlock title="Assist conversation">
        <ConversationMessageList messages={messages} />
      </DetailBlock>
      <DetailBlock title="Resolution controls">
        <ConversationActionBar />
      </DetailBlock>
      <DetailBlock title="Composer">
        <ConversationComposer />
      </DetailBlock>
    </section>
  );
}
