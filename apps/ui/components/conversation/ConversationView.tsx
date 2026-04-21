import type { ChatMessageViewModel } from "@/lib/view-models";
import { ConversationActionBar } from "@/components/conversation/ConversationActionBar";
import { ConversationComposer } from "@/components/conversation/ConversationComposer";
import { ConversationMessageList } from "@/components/conversation/ConversationMessageList";

export function ConversationView({ messages }: { messages: ChatMessageViewModel[] }) {
  return (
    <section className="stack-panel">
      <div className="detail-block">
        <h3>Assist conversation</h3>
        <ConversationMessageList messages={messages} />
      </div>
      <div className="detail-block">
        <h3>Resolution controls</h3>
        <ConversationActionBar />
      </div>
      <div className="detail-block">
        <h3>Composer</h3>
        <ConversationComposer />
      </div>
    </section>
  );
}
