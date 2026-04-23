import Link from "next/link"
import { AppShell } from "@/components/shell/AppShell"
import { Panel } from "@/components/primitives/Panel"
import { SectionTitle } from "@/components/primitives/SectionTitle"
import { shellViewModel } from "@/lib/mock-legacy-data"
import { listRuns } from "@/lib/api"
import { StartRunForm } from "@/components/runs/StartRunForm"

export const dynamic = "force-dynamic"

export default async function RunsPage({
  searchParams,
}: {
  searchParams?: Promise<{ workspace?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const runs = await listRuns().catch(() => [])
  const defaultWorkspaceKey = resolvedSearchParams?.workspace?.trim() || "alpha"

  return (
    <AppShell shell={shellViewModel} activeHref="/runs" workspaceHrefBase="/runs">
      <Panel className="padded stack-panel">
        <SectionTitle
          title="Runs"
          description="Start a new workflow run or resume one in progress. Each run drives the engine and streams live updates here."
        />
        <div className="runs-grid">
          <section className="runs-start">
            <h3>Start a new run</h3>
            <StartRunForm defaultWorkspaceKey={defaultWorkspaceKey} />
          </section>
          <section className="runs-list">
            <h3>Recent runs ({runs.length})</h3>
            {runs.length === 0 ? (
              <p className="muted">No runs yet. Kick one off with the form on the left.</p>
            ) : (
              <ul>
                {runs.map(run => (
                  <li key={run.id}>
                    <Link href={`/runs/${run.id}`} className="run-row" data-status={run.status}>
                      <strong>{run.title}</strong>
                      <span className="mono-label">{run.status}</span>
                      <span className="muted">{run.current_stage ?? "—"}</span>
                      <time>{new Date(run.created_at).toLocaleString()}</time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Panel>
    </AppShell>
  )
}
