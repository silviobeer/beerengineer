import type { SetupViewModel } from "@/lib/view-models";
import { ConversationView } from "@/components/conversation/ConversationView";
import { BootstrapPlanForm } from "@/components/setup/BootstrapPlanForm";
import { CreateWorkspaceForm } from "@/components/setup/CreateWorkspaceForm";
import { SetupAssistComposer } from "@/components/setup/SetupAssistComposer";
import { WorkspaceInitForm } from "@/components/setup/WorkspaceInitForm";
import { WorkspaceRootForm } from "@/components/setup/WorkspaceRootForm";
import { MonoLabel } from "@/components/primitives/MonoLabel";
import { StatusChip } from "@/components/primitives/StatusChip";
import type { ChatMessageViewModel } from "@/lib/view-models";

export function SetupOverview({ setup, messages }: { setup: SetupViewModel; messages: ChatMessageViewModel[] }) {
  return (
    <div className="setup-grid">
      <section className="stack-panel">
        <div className="board-head">
          <div>
            <MonoLabel>Workspace setup</MonoLabel>
            <h2>{setup.heading}</h2>
            <p>{setup.description}</p>
          </div>
          <StatusChip label={setup.overallStatus} tone="gold" />
        </div>
        <div className="panel padded">
          <div className="setup-actions">
            <div>
              <h3>Suggested actions</h3>
              <ul>
                {setup.suggestedActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Auto-fixable</h3>
              <ul>
                {setup.autoFixes.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="setup-categories">
          {setup.categories.map((category) => (
            <div key={category.title} className="panel padded">
              <h3>{category.title}</h3>
              <p>{category.summary}</p>
              <div className="setup-checks">
                {category.checks.map((check) => (
                  <div key={check.name} className="list-row setup-check">
                    <div>
                      <strong>{check.name}</strong>
                      <p>{check.detail}</p>
                    </div>
                    <StatusChip label={check.status} tone={check.status === "ok" ? "success" : check.status === "blocked" ? "danger" : "gold"} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="stack-panel">
        <CreateWorkspaceForm />
        <WorkspaceRootForm />
        <WorkspaceInitForm />
        <SetupAssistComposer />
        <BootstrapPlanForm />
        <ConversationView messages={messages} />
      </section>
    </div>
  );
}
