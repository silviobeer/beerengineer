export function ConversationComposer() {
  return (
    <div className="composer">
      <textarea rows={4} defaultValue="Initialize the directories first. Keep git changes explicit." />
      <button className="button button-primary">Send input</button>
    </div>
  );
}
