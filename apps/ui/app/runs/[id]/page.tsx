import { AppShell } from "@/components/shell/AppShell"
import { Panel } from "@/components/primitives/Panel"
import { SectionTitle } from "@/components/primitives/SectionTitle"
import { shellViewModel } from "@/lib/mock-legacy-data"
import { LiveRunConsole } from "@/components/runs/LiveRunConsole"

export const dynamic = "force-dynamic"

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <AppShell shell={shellViewModel} activeHref="/runs">
      <Panel className="padded stack-panel">
        <SectionTitle
          title="Run console"
          description="Live timeline, stage progress, and operator prompt feed for this run."
        />
        <LiveRunConsole runId={id} />
      </Panel>
    </AppShell>
  )
}
