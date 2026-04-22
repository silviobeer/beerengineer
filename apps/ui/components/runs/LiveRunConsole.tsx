"use client"

import { useEffect, useRef, useState } from "react"
import { ENGINE_BASE_URL, answerPrompt, type RunRow, type StageRunRow } from "@/lib/api"
import { RecoveryPanel } from "./RecoveryPanel"

type TimelineEntry = {
  id: string
  type: string
  at: number
  message: string
  data?: unknown
}

type PendingPrompt = { id: string; prompt: string } | null

export function LiveRunConsole({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunRow | null>(null)
  const [stages, setStages] = useState<StageRunRow[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [pending, setPending] = useState<PendingPrompt>(null)
  const [answer, setAnswer] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [recoveryRefreshKey, setRecoveryRefreshKey] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)

  async function refreshTree() {
    const res = await fetch(`${ENGINE_BASE_URL}/runs/${runId}/tree`, { cache: "no-store" })
    if (!res.ok) return
    const body = (await res.json()) as { run: RunRow; stageRuns: StageRunRow[] }
    setRun(body.run)
    setStages(body.stageRuns)
  }

  async function refreshPrompt() {
    const res = await fetch(`${ENGINE_BASE_URL}/runs/${runId}/prompts`, { cache: "no-store" })
    if (!res.ok) return
    const body = (await res.json()) as { prompt: { id: string; prompt: string } | null }
    setPending(body.prompt ? { id: body.prompt.id, prompt: body.prompt.prompt } : null)
  }

  useEffect(() => {
    void refreshTree()
    void refreshPrompt()

    const source = new EventSource(`${ENGINE_BASE_URL}/runs/${runId}/events`)
    sourceRef.current = source

    const append = (type: string, data: unknown) => {
      const entry: TimelineEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        at: Date.now(),
        message: typeof (data as { message?: string })?.message === "string" ? (data as { message: string }).message : type,
        data
      }
      setTimeline(prev => [...prev, entry].slice(-200))
    }

    const wire = (type: string) => {
      source.addEventListener(type, evt => {
        try {
          const payload = JSON.parse((evt as MessageEvent).data as string)
          append(type, payload)
        } catch {
          append(type, null)
        }
        void refreshTree()
        if (type === "prompt_requested" || type === "prompt_answered") {
          void refreshPrompt()
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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!pending || !answer.trim() || submitting) return
    setSubmitting(true)
    try {
      await answerPrompt(runId, pending.id, answer)
      setAnswer("")
      setPending(null)
    } finally {
      setSubmitting(false)
    }
  }

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
        </div>
      </header>

      <RecoveryPanel runId={runId} refreshKey={recoveryRefreshKey} />

      <section className="live-run-stages">
        <div className="section-title">Stages</div>
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

      {pending ? (
        <form className="prompt-form" onSubmit={onSubmit}>
          <label>
            <span className="mono-label">Engine asks</span>
            <pre className="prompt-text">{pending.prompt}</pre>
          </label>
          <textarea
            value={answer}
            onChange={event => setAnswer(event.target.value)}
            placeholder="Type your answer here and press Enter"
            rows={3}
            autoFocus
          />
          <button type="submit" disabled={submitting || !answer.trim()}>
            {submitting ? "Sending…" : "Answer"}
          </button>
        </form>
      ) : run?.status === "running" ? (
        <div className="prompt-waiting">Waiting for engine…</div>
      ) : null}

      <section className="live-run-timeline">
        <div className="section-title">Timeline</div>
        <ul>
          {timeline.map(entry => (
            <li key={entry.id} data-kind={entry.type}>
              <span className="mono-label">{entry.type}</span>
              <span>{entry.message}</span>
            </li>
          ))}
          {timeline.length === 0 ? <li className="muted">Listening for events…</li> : null}
        </ul>
      </section>
    </div>
  )
}
