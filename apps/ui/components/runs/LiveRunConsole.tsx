"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { type ConversationEntry, type ConversationResponse, type RunRow, type StageRunRow } from "@/lib/api"
import { PromptComposer } from "@/components/primitives/PromptComposer"
import { BranchRow } from "@/components/primitives/BranchRow"
import { ItemMergePanel } from "@/components/overlay/ItemMergePanel"
import { PreviewBody } from "@/components/overlay/ItemPreviewCard"
import type {
  BranchRowViewModel,
  MergePanelViewModel,
  PreviewViewModel
} from "@/lib/view-models"
import { RecoveryPanel } from "./RecoveryPanel"

type PendingPrompt = { id: string; prompt: string } | null

type Tab = "transcript" | "stages" | "branches" | "preview"

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "transcript", label: "Transcript" },
  { key: "stages", label: "Stages" },
  { key: "branches", label: "Branches" },
  { key: "preview", label: "Preview" }
]

function formatTranscriptTimestamp(at: number): string {
  return new Intl.DateTimeFormat("de-CH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(new Date(at))
}

function actorLabel(entry: ConversationEntry): string {
  if (entry.kind === "answer") return "You"
  if (entry.actor === "user") return "You"
  if (entry.actor === "agent") return entry.stageKey ?? "Assistant"
  return "system"
}

function deriveBranches(run: RunRow | null): BranchRowViewModel[] {
  if (!run) return []
  const rows: BranchRowViewModel[] = [
    { scope: "main", name: "main", status: "active", detail: "default base" }
  ]
  if (run.recovery_status === "blocked" && run.recovery_scope === "story") {
    rows.push({
      scope: "candidate",
      name: `candidate/${run.id.slice(0, 8)}`,
      base: "main",
      status: "open_candidate",
      detail: "awaiting review"
    })
  }
  return rows
}

function deriveMerge(run: RunRow | null): MergePanelViewModel {
  return {
    candidateBranch: run?.recovery_status === "blocked" && run.recovery_scope === "story" ? `candidate/${run.id.slice(0, 8)}` : null,
    baseBranch: "main",
    checklistSummary: run?.recovery_status === "blocked" ? "Recovery pending" : "No merge candidate",
    validationStatus: "preview only",
    backendReady: false
  }
}

function derivePreview(run: RunRow | null, reachable: boolean, previewUrl?: string | null): PreviewViewModel {
  return {
    available: Boolean(run),
    previewLabel: run ? `run/${run.id.slice(0, 8)}` : undefined,
    previewOriginType: reachable ? "network-url" : "proxied-url",
    previewUrl: reachable ? previewUrl ?? undefined : undefined,
    sourceHost: "engine host",
    reachable,
    helperText:
      reachable
        ? "Preview target is reachable from this browser session."
        : "Preview lives on the engine host. Open the test target from the engine machine, or wait for a proxied URL."
  }
}

export function LiveRunConsole({
  runId,
  previewReachable = false,
  previewUrl = null,
}: {
  runId: string
  previewReachable?: boolean
  previewUrl?: string | null
}) {
  const searchParams = useSearchParams()
  const initialTab = (searchParams?.get("tab") as Tab) ?? "transcript"
  const [tab, setTab] = useState<Tab>(initialTab)
  const [run, setRun] = useState<RunRow | null>(null)
  const [stages, setStages] = useState<StageRunRow[]>([])
  const [entries, setEntries] = useState<ConversationEntry[]>([])
  const [pending, setPending] = useState<PendingPrompt>(null)
  const [recoveryRefreshKey, setRecoveryRefreshKey] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)

  async function refreshTree() {
    const res = await fetch(`/api/runs/${runId}/tree`, { cache: "no-store" })
    if (!res.ok) return
    const body = (await res.json()) as { run: RunRow; stageRuns: StageRunRow[] }
    setRun(body.run)
    setStages(body.stageRuns)
  }

  async function refreshConversation() {
    const res = await fetch(`/api/runs/${runId}/conversation`, { cache: "no-store" })
    if (!res.ok) return
    const body = (await res.json()) as ConversationResponse
    setEntries(body.entries)
    setPending(
      body.openPrompt
        ? { id: body.openPrompt.promptId, prompt: body.openPrompt.text }
        : null
    )
  }

  useEffect(() => {
    const nextTab = (searchParams?.get("tab") as Tab) ?? "transcript"
    setTab(nextTab)
  }, [searchParams])

  useEffect(() => {
    void refreshTree()
    void refreshConversation()

    const source = new EventSource(`/api/runs/${runId}/events`)
    sourceRef.current = source

    const wire = (type: string) => {
      source.addEventListener(type, () => {
        void refreshTree()
        if (
          type === "prompt_requested" ||
          type === "prompt_answered" ||
          type === "chat_message" ||
          type === "run_finished"
        ) {
          void refreshConversation()
        }
      })
    }

    ;[
      "hello",
      "run_started",
      "run_finished",
      "stage_started",
      "stage_completed",
      "prompt_requested",
      "prompt_answered",
      "chat_message",
      "presentation",
      "artifact_written",
      "log",
      "item_column_changed",
      "run_blocked",
      "run_failed",
      "external_remediation_recorded",
      "run_resumed"
    ].forEach(wire)

    ;["run_blocked", "run_failed", "external_remediation_recorded", "run_resumed"].forEach(type => {
      source.addEventListener(type, () => setRecoveryRefreshKey(k => k + 1))
    })

    source.onerror = () => {
      void refreshTree()
    }

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [runId])

  const branches = deriveBranches(run)
  const merge = deriveMerge(run)
  const preview = derivePreview(run, previewReachable, previewUrl)

  return (
    <div className="live-run-console">
      {/* Section 1 — Run header. */}
      <header className="live-run-header">
        <div>
          <div className="mono-label">Run</div>
          <strong>{run?.title ?? runId}</strong>
        </div>
        <div className="live-run-status" data-status={run?.status ?? "unknown"}>
          <span>{run?.status ?? "loading"}</span>
          {run?.current_stage ? <span className="mono-label">stage: {run.current_stage}</span> : null}
          {branches.find(b => b.scope === "candidate") ? (
            <span className="mono-label">candidate: {branches.find(b => b.scope === "candidate")?.name}</span>
          ) : null}
        </div>
      </header>

      {/* Section 2 — Active prompt strip. Pinned. */}
      {pending ? (
        <PromptComposer
          runId={runId}
          promptId={pending.id}
          prompt={pending.prompt}
          variant="full"
          autoFocus
          onAnswered={() => {
            setPending(null)
            void refreshConversation()
          }}
        />
      ) : run?.status === "running" ? (
        <div className="prompt-waiting">Waiting for engine…</div>
      ) : null}

      {/* Section 6 — Recovery panel sits high so blockers are visible. */}
      <RecoveryPanel runId={runId} refreshKey={recoveryRefreshKey} />

      {/* Tabs for the rest of the workspace. */}
      <div className="run-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="run-tab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "transcript" ? (
        <section className="run-section live-run-timeline" role="tabpanel">
          <h3>Conversation transcript</h3>
          <ul>
            {entries.map(entry => (
              <li
                key={entry.id}
                data-kind={entry.kind}
                data-actor={entry.actor}
                data-stage={entry.stageKey ?? ""}
              >
                <span className="mono-label">{entry.kind}</span>
                <span className="mono-label">{actorLabel(entry)}</span>
                <span className="timeline-timestamp">{formatTranscriptTimestamp(Date.parse(entry.createdAt))}</span>
                <span>{entry.text}</span>
              </li>
            ))}
            {entries.length === 0 ? <li className="muted">Listening for events…</li> : null}
          </ul>
        </section>
      ) : null}

      {tab === "stages" ? (
        <section className="run-section live-run-stages" role="tabpanel">
          <h3>Stage inspector</h3>
          <ol>
            {stages.map(stage => (
              <li key={stage.id} data-status={stage.status}>
                <span>{stage.stage_key}</span>
                <span className="mono-label">{stage.status}</span>
                {stage.error_message ? <span className="error-text">{stage.error_message}</span> : null}
              </li>
            ))}
            {stages.length === 0 ? <li className="muted">No stage runs yet</li> : null}
          </ol>
        </section>
      ) : null}

      {tab === "branches" ? (
        <section className="run-section" role="tabpanel">
          <h3>Branch panel</h3>
          <div className="detail-list branch-list">
            {branches.length === 0 ? (
              <p className="muted">No branch information available.</p>
            ) : (
              branches.map((b, i) => <BranchRow key={`${b.scope}-${b.name}-${i}`} branch={b} />)
            )}
          </div>
          <ItemMergePanel merge={merge} />
        </section>
      ) : null}

      {tab === "preview" ? (
        <section className="run-section" role="tabpanel">
          <h3>Test preview</h3>
          <PreviewBody preview={preview} />
        </section>
      ) : null}
    </div>
  )
}
