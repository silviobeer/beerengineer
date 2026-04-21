"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { startRun } from "@/lib/api"

export function StartRunForm({ defaultWorkspaceKey }: { defaultWorkspaceKey?: string }) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [workspaceKey, setWorkspaceKey] = useState(defaultWorkspaceKey ?? "alpha")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await startRun({ title: title.trim(), description: description.trim(), workspaceKey })
      if ("error" in res) {
        setError(res.error)
        return
      }
      router.push(`/runs/${res.runId}`)
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="start-run-form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="run-title">Title</label>
        <input
          id="run-title"
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Short idea title"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="run-desc">Description</label>
        <textarea
          id="run-desc"
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="One paragraph problem statement"
          rows={3}
        />
      </div>
      <div className="field">
        <label htmlFor="run-workspace">Workspace key</label>
        <input
          id="run-workspace"
          value={workspaceKey}
          onChange={event => setWorkspaceKey(event.target.value)}
        />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <button type="submit" disabled={submitting || !title.trim()}>
        {submitting ? "Starting…" : "Start run"}
      </button>
    </form>
  )
}
