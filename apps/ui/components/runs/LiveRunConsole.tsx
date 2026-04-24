"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { type MessageEntry, type MessagingLevel, type OpenPrompt, type RunRow, type StageRunRow } from "@/lib/api"
import { PromptComposer } from "@/components/primitives/PromptComposer"
import { BranchRow } from "@/components/primitives/BranchRow"
import { ItemMergePanel } from "@/components/overlay/ItemMergePanel"
import { PreviewBody } from "@/components/overlay/ItemPreviewCard"
import type {
  BranchRowViewModel,
  MergePanelViewModel,
  PreviewViewModel,
} from "@/lib/view-models"
import { RecoveryPanel } from "./RecoveryPanel"

type PendingPrompt = { id: string; prompt: string } | null

type Tab = "transcript" | "stages" | "branches" | "preview"

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "transcript", label: "Transcript" },
  { key: "stages", label: "Stages" },
  { key: "branches", label: "Branches" },
  { key: "preview", label: "Preview" },
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

function levelLabel(level: MessagingLevel): "L0" | "L1" | "L2" {
  if (level === 0) return "L0"
  if (level === 1) return "L1"
  return "L2"
}

function levelHint(level: MessagingLevel): string {
  if (level === 0) return "Full backstage pass: tools, thinking, and token chatter."
  if (level === 1) return "Operator mode: milestones plus useful action detail."
  return "Big beats only: the cheerful headline reel."
}

function messageKind(entry: MessageEntry): "system" | "message" | "question" | "answer" | "event" {
  if (entry.type === "prompt_requested") return "question"
  if (entry.type === "prompt_answered") return "answer"
  if (entry.type === "agent_message" || entry.type === "user_message" || entry.type === "llm_thinking") return "message"
  return "event"
}

function messageIcon(entry: MessageEntry): string {
  switch (entry.type) {
    case "run_started":
      return "🚀"
    case "run_finished":
      return "🏁"
    case "run_failed":
      return "💥"
    case "run_blocked":
      return "🧱"
    case "run_resumed":
      return "🪄"
    case "phase_started":
      return "🧭"
    case "phase_completed":
      return "✅"
    case "phase_failed":
      return "⚠️"
    case "prompt_requested":
      return "❓"
    case "prompt_answered":
      return "💬"
    case "agent_message":
      return "🤖"
    case "user_message":
      return "🧑"
    case "loop_iteration":
      return "🔁"
    case "tool_called":
      return "🛠️"
    case "tool_result":
      return "📦"
    case "llm_thinking":
      return "💭"
    case "llm_tokens":
      return "🔢"
    case "artifact_written":
      return "📝"
    case "external_remediation_recorded":
      return "🩹"
    case "log":
      return "📎"
    case "presentation":
      return "✨"
    default:
      return "•"
  }
}

function actorLabel(entry: MessageEntry): string {
  if (entry.type === "prompt_answered" || entry.type === "user_message") return "You"
  if (entry.type === "agent_message") return String(entry.payload.role ?? entry.payload.source ?? "Assistant")
  if (entry.type === "tool_called" || entry.type === "tool_result" || entry.type === "llm_tokens" || entry.type === "llm_thinking") {
    return String(entry.payload.provider ?? "engine")
  }
  return typeof entry.payload.stageKey === "string" ? entry.payload.stageKey : "system"
}

function messageText(entry: MessageEntry): string {
  switch (entry.type) {
    case "run_started":
      return `Off we go with ${String(entry.payload.title ?? entry.runId)}.`
    case "run_finished":
      return entry.payload.status === "failed" ? "The run wrapped up in a failed state." : "The run crossed the finish line."
    case "run_failed":
      return `The run hit a hard stop: ${String(entry.payload.summary ?? "unknown")}`
    case "run_blocked":
      return `The engine needs a hand here: ${String(entry.payload.summary ?? "unknown")}`
    case "run_resumed":
      return "Back in motion."
    case "phase_started":
      return `Starting ${String(entry.payload.stageKey ?? "unknown")}.`
    case "phase_completed":
      return `${String(entry.payload.stageKey ?? "unknown")} is done.`
    case "phase_failed":
      return `${String(entry.payload.stageKey ?? "unknown")} stumbled.`
    case "prompt_requested":
      return `Question for you: ${String(entry.payload.prompt ?? "Awaiting input")}`
    case "prompt_answered":
      return `You answered: ${String(entry.payload.answer ?? "")}`
    case "agent_message":
    case "user_message":
    case "llm_thinking":
      return String(entry.payload.text ?? "")
    case "loop_iteration":
      return `Pass ${String(entry.payload.n ?? 0)} in ${String(entry.payload.phase ?? "begin")}.`
    case "tool_called":
      return `Calling ${String(entry.payload.name ?? "tool")}${typeof entry.payload.argsPreview === "string" ? ` with ${entry.payload.argsPreview}` : ""}`
    case "tool_result":
      return `${String(entry.payload.name ?? "tool")} came back${typeof entry.payload.resultPreview === "string" ? ` with ${entry.payload.resultPreview}` : "."}`
    case "llm_tokens":
      return [
        `Token count: in ${String(entry.payload.in ?? 0)}, out ${String(entry.payload.out ?? 0)}`,
        typeof entry.payload.cached === "number" ? `cache=${entry.payload.cached}` : undefined,
        typeof entry.payload.model === "string" ? entry.payload.model : undefined,
      ].filter(Boolean).join(" ")
    case "artifact_written":
      return `Saved artifact: ${String(entry.payload.label ?? "artifact")}`
    case "external_remediation_recorded":
      return `Remediation noted: ${String(entry.payload.summary ?? "")}`
    case "log":
      return String(entry.payload.message ?? "")
    case "presentation":
      return String(entry.payload.text ?? "")
    default:
      return String(entry.payload.rawType ?? entry.type)
  }
}

function deriveBranches(run: RunRow | null): BranchRowViewModel[] {
  if (!run) return []
  const rows: BranchRowViewModel[] = [{ scope: "main", name: "main", status: "active", detail: "default base" }]
  if (run.recovery_status === "blocked" && run.recovery_scope === "story") {
    rows.push({
      scope: "candidate",
      name: `candidate/${run.id.slice(0, 8)}`,
      base: "main",
      status: "open_candidate",
      detail: "awaiting review",
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
    backendReady: false,
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
    helperText: reachable
      ? "Preview target is reachable from this browser session."
      : "Preview lives on the engine host. Open the test target from the engine machine, or wait for a proxied URL.",
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
  const [level, setLevel] = useState<MessagingLevel>(1)
  const [run, setRun] = useState<RunRow | null>(null)
  const [stages, setStages] = useState<StageRunRow[]>([])
  const [entries, setEntries] = useState<MessageEntry[]>([])
  const [pending, setPending] = useState<PendingPrompt>(null)
  const [recoveryRefreshKey, setRecoveryRefreshKey] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)
  const lastMessageIdRef = useRef<string | null>(null)

  async function refreshRunAndTree() {
    const [treeRes, runRes] = await Promise.all([
      fetch(`/api/runs/${runId}/tree`, { cache: "no-store" }),
      fetch(`/api/runs/${runId}`, { cache: "no-store" }),
    ])
    if (treeRes.ok) {
      const body = (await treeRes.json()) as { run: RunRow; stageRuns: StageRunRow[] }
      setStages(body.stageRuns)
    }
    if (runRes.ok) {
      const body = (await runRes.json()) as RunRow
      setRun(body)
      const openPrompt = (body.openPrompt as OpenPrompt | null | undefined) ?? null
      setPending(openPrompt ? { id: openPrompt.promptId, prompt: openPrompt.text } : null)
    }
  }

  async function refreshMessages() {
    const nextEntries: MessageEntry[] = []
    let cursor: string | undefined
    while (true) {
      const qs = new URLSearchParams({ level: String(level), limit: "500" })
      if (cursor) qs.set("since", cursor)
      const res = await fetch(`/api/runs/${runId}/messages?${qs.toString()}`, { cache: "no-store" })
      if (!res.ok) return
      const body = (await res.json()) as { entries: MessageEntry[]; nextSince: string | null }
      nextEntries.push(...body.entries)
      if (!body.nextSince || body.entries.length === 0) break
      cursor = body.nextSince
    }
    setEntries(nextEntries)
    lastMessageIdRef.current = nextEntries.at(-1)?.id ?? null
  }

  useEffect(() => {
    const nextTab = (searchParams?.get("tab") as Tab) ?? "transcript"
    setTab(nextTab)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    let source: EventSource | null = null

    async function bootstrap() {
      await Promise.all([refreshRunAndTree(), refreshMessages()])
      if (cancelled) return

      // Open the live tail *after* history has loaded so `since` anchors the
      // stream to the last message already on screen. Without this await the
      // stream re-replays from rowid=0 on every mount.
      const qs = new URLSearchParams({ level: String(level) })
      if (lastMessageIdRef.current) qs.set("since", lastMessageIdRef.current)
      source = new EventSource(`/api/runs/${runId}/events?${qs.toString()}`)
      sourceRef.current = source

      const wire = (type: string) => {
        source!.addEventListener(type, event => {
          const entry = JSON.parse((event as MessageEvent<string>).data) as MessageEntry
          setEntries(current => (current.some(existing => existing.id === entry.id) ? current : [...current, entry]))
          lastMessageIdRef.current = entry.id
          void refreshRunAndTree()
        })
      }

      ;[
        "run_started",
        "run_finished",
        "run_failed",
        "run_blocked",
        "run_resumed",
        "phase_started",
        "phase_completed",
        "phase_failed",
        "prompt_requested",
        "prompt_answered",
        "agent_message",
        "user_message",
        "loop_iteration",
        "tool_called",
        "tool_result",
        "llm_thinking",
        "llm_tokens",
        "artifact_written",
        "log",
        "presentation",
        "external_remediation_recorded",
      ].forEach(wire)

      ;["run_blocked", "run_failed", "external_remediation_recorded", "run_resumed"].forEach(type => {
        source!.addEventListener(type, () => setRecoveryRefreshKey(current => current + 1))
      })

      source.onerror = () => {
        void refreshRunAndTree()
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
      source?.close()
      sourceRef.current = null
    }
  }, [runId, level])

  const branches = deriveBranches(run)
  const merge = deriveMerge(run)
  const preview = derivePreview(run, previewReachable, previewUrl)

  return (
    <div className="live-run-console">
      <header className="live-run-header">
        <div>
          <div className="mono-label">Run</div>
          <strong>{run?.title ?? runId}</strong>
        </div>
        <div className="live-run-status" data-status={run?.status ?? "unknown"}>
          <span>{run?.status ?? "loading"}</span>
          {run?.current_stage ? <span className="mono-label">stage: {run.current_stage}</span> : null}
          {branches.find(branch => branch.scope === "candidate") ? (
            <span className="mono-label">candidate: {branches.find(branch => branch.scope === "candidate")?.name}</span>
          ) : null}
        </div>
      </header>

      {pending ? (
        <PromptComposer
          runId={runId}
          promptId={pending.id}
          prompt={pending.prompt}
          variant="full"
          autoFocus
          onAnswered={() => {
            setPending(null)
            void refreshRunAndTree()
          }}
        />
      ) : run?.status === "running" ? (
        <div className="prompt-waiting">Waiting for engine…</div>
      ) : null}

      <RecoveryPanel runId={runId} refreshKey={recoveryRefreshKey} />

      <div className="run-tabs" role="tablist">
        {TABS.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className="run-tab"
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "transcript" ? (
        <section className="run-section live-run-timeline" role="tabpanel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
            <div>
              <h3>Run timeline</h3>
              <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "13px" }}>{levelHint(level)}</p>
            </div>
            <div className="run-tabs" role="tablist" aria-label="Message detail level">
              {[2, 1, 0].map(candidate => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={level === candidate}
                  className="run-tab"
                  onClick={() => setLevel(candidate as MessagingLevel)}
                >
                  {levelLabel(candidate as MessagingLevel)}
                </button>
              ))}
            </div>
          </div>
          <ul>
            {entries.map(entry => (
              <li
                key={entry.id}
                data-kind={messageKind(entry)}
                data-type={entry.type}
                data-actor={actorLabel(entry)}
                data-stage={typeof entry.payload.stageKey === "string" ? entry.payload.stageKey : ""}
              >
                <span className="timeline-icon" aria-hidden="true">{messageIcon(entry)}</span>
                <div className="timeline-main">
                  <div className="timeline-head">
                    <span className="mono-label">{messageKind(entry)}</span>
                    <span className="mono-label">{actorLabel(entry)}</span>
                    <span className="mono-label">{entry.type}</span>
                    <span className="timeline-timestamp">{formatTranscriptTimestamp(Date.parse(entry.ts))}</span>
                  </div>
                  <div className="timeline-copy">{messageText(entry)}</div>
                </div>
              </li>
            ))}
            {entries.length === 0 ? <li className="muted">Listening for messages…</li> : null}
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
              branches.map((branch, index) => <BranchRow key={`${branch.scope}-${branch.name}-${index}`} branch={branch} />)
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
