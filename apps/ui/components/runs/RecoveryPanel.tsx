"use client"

import { useEffect, useState } from "react"
import { getRunRecovery, resumeRun, type RecoveryDetail } from "@/lib/api"

type Props = {
  runId: string
  /** Bump this to force a refetch — e.g. when an SSE `run_blocked` / `run_resumed` arrives. */
  refreshKey?: number
}

export function RecoveryPanel({ runId, refreshKey = 0 }: Props) {
  const [recovery, setRecovery] = useState<RecoveryDetail | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getRunRecovery(runId).then(rec => {
      if (!cancelled) setRecovery(rec)
    })
    return () => {
      cancelled = true
    }
  }, [runId, refreshKey])

  if (!recovery) return null

  return (
    <section className="recovery-panel" data-status={recovery.status}>
      <header className="recovery-header">
        <span className="recovery-chip" data-status={recovery.status}>
          {recovery.status === "blocked" ? "Blocked" : "Failed"}
        </span>
        <div>
          <div className="mono-label">Scope</div>
          <strong>
            {recovery.scope ?? "run"}
            {recovery.scopeRef ? ` · ${recovery.scopeRef}` : ""}
          </strong>
        </div>
      </header>

      {recovery.summary ? <p className="recovery-summary">{recovery.summary}</p> : null}

      {recovery.remediations.length > 0 ? (
        <details className="recovery-remediations">
          <summary>{recovery.remediations.length} prior remediation(s)</summary>
          <ul>
            {recovery.remediations.map(r => (
              <li key={r.id}>
                <span className="mono-label">{new Date(r.created_at).toLocaleString()}</span>
                <span>{r.summary}</span>
                {r.branch ? <span className="mono-label">branch: {r.branch}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {recovery.resumable ? (
        <button className="recovery-resume-cta" type="button" onClick={() => setOpen(true)}>
          Resume After External Fix
        </button>
      ) : null}

      {open ? (
        <ResumeAfterFixModal
          runId={runId}
          onClose={() => setOpen(false)}
          onResumed={() => {
            setOpen(false)
            // SSE will emit `run_resumed` which clears the recovery — but
            // refetch now too for users whose SSE stream isn't live.
            void getRunRecovery(runId).then(setRecovery)
          }}
        />
      ) : null}
    </section>
  )
}

function ResumeAfterFixModal({
  runId,
  onClose,
  onResumed,
}: {
  runId: string
  onClose: () => void
  onResumed: () => void
}) {
  const [summary, setSummary] = useState("")
  const [branch, setBranch] = useState("")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!summary.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await resumeRun(runId, {
      summary: summary.trim(),
      branch: branch.trim() || undefined,
      reviewNotes: notes.trim() || undefined,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onResumed()
  }

  return (
    <div className="recovery-modal-backdrop" role="dialog" aria-modal="true">
      <form className="recovery-modal" onSubmit={submit}>
        <h3>Resume after external fix</h3>
        <p className="muted">
          Describe what you changed outside BeerEngineer2. The summary is injected into the next
          implementation and review prompt.
        </p>
        <label>
          <span className="mono-label">Remediation summary (required)</span>
          <textarea
            value={summary}
            onChange={e => setSummary(e.target.value)}
            rows={3}
            autoFocus
            required
          />
        </label>
        <label>
          <span className="mono-label">Branch (optional)</span>
          <input value={branch} onChange={e => setBranch(e.target.value)} />
        </label>
        <label>
          <span className="mono-label">Review notes (optional)</span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </label>
        {error ? <div className="error-text">Resume failed: {error}</div> : null}
        <div className="recovery-modal-actions">
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || !summary.trim()}>
            {submitting ? "Resuming…" : "Resume"}
          </button>
        </div>
      </form>
    </div>
  )
}
