export function SetupAssistComposer() {
  return (
    <div className="form-card">
      <h3>Setup assist</h3>
      <label className="form-field">
        <span>Message</span>
        <textarea
          rows={4}
          defaultValue="Inspect the workspace state and suggest the safest next actions before bootstrap."
        />
      </label>
    </div>
  );
}
