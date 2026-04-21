import { AppShell } from "@/components/shell/AppShell";
import { Panel } from "@/components/primitives/Panel";
import { SectionTitle } from "@/components/primitives/SectionTitle";
import { shellViewModel } from "@/lib/mock-legacy-data";

export default function SettingsPage() {
  return (
    <AppShell shell={shellViewModel} activeHref="/settings">
      <Panel className="padded stack-panel">
        <SectionTitle
          title="Settings"
          description="Settings keeps the same shell chrome and remains scoped to the active workspace."
        />
        <div className="settings-grid">
          <div className="form-card">
            <h3>Workspace defaults</h3>
            <p>Interactive default: assisted</p>
            <p>Autonomous default: auto</p>
            <p>Runtime profile: local-fixture</p>
          </div>
          <div className="form-card">
            <h3>Future scope</h3>
            <p>Runtime profiles, verification defaults, app-test config and UI metadata belong here once service handlers are exposed.</p>
          </div>
        </div>
      </Panel>
    </AppShell>
  );
}
