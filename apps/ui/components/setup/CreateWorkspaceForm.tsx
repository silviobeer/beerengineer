"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/primitives/Button"
import { createWorkspace, previewWorkspace, type WorkspacePreview } from "@/lib/api"

const defaultPath = "/home/silvio/projects/helloworld"

export function CreateWorkspaceForm() {
  const router = useRouter()
  const [key, setKey] = useState("helloworld")
  const [name, setName] = useState("HelloWorld")
  const [path, setPath] = useState(defaultPath)
  const [preview, setPreview] = useState<WorkspacePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loading, setLoading] = useState<"preview" | "create" | null>(null)

  async function onPreview() {
    setLoading("preview")
    setError(null)
    setSuccess(null)
    const result = await previewWorkspace(path.trim())
    if ("error" in result) {
      setPreview(null)
      setError(result.error)
      setLoading(null)
      return
    }
    setPreview(result)
    setLoading(null)
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault()
    setLoading("create")
    setError(null)
    setSuccess(null)
    const result = await createWorkspace({
      path: path.trim(),
      key: key.trim() || undefined,
      name: name.trim() || undefined,
    })
    if (!result.ok) {
      setError(`${result.error}: ${result.detail}`)
      setLoading(null)
      return
    }
    setSuccess(`Workspace ${result.workspace.key} registered.`)
    setLoading(null)
    router.push(`/runs?workspace=${encodeURIComponent(result.workspace.key)}`)
    router.refresh()
  }

  return (
    <form className="form-card stack-form" onSubmit={onCreate}>
      <h3>Create workspace</h3>
      <label className="form-field">
        <span>Key</span>
        <input type="text" value={key} onChange={(event) => setKey(event.target.value)} />
      </label>
      <label className="form-field">
        <span>Name</span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="form-field">
        <span>Root path</span>
        <input type="text" value={path} onChange={(event) => setPath(event.target.value)} />
      </label>
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={onPreview} disabled={loading !== null || !path.trim()}>
          {loading === "preview" ? "Previewing…" : "Preview"}
        </Button>
        <Button type="submit" variant="primary" disabled={loading !== null || !path.trim()}>
          {loading === "create" ? "Creating…" : "Create workspace"}
        </Button>
      </div>
      {preview ? (
        <div className="form-feedback" data-tone={preview.conflicts.length > 0 ? "warning" : "success"}>
          <strong>{preview.isRegistered ? "Already registered" : "Preview ready"}</strong>
          <p>
            {preview.path} · {preview.detectedStack ?? "unknown stack"} · {preview.isGitRepo ? "git repo" : "no git"}
          </p>
          {preview.conflicts.length > 0 ? <p>{preview.conflicts.join(" · ")}</p> : null}
        </div>
      ) : null}
      {error ? (
        <div className="form-feedback" data-tone="danger">
          <strong>Workspace action failed</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {success ? (
        <div className="form-feedback" data-tone="success">
          <strong>{success}</strong>
        </div>
      ) : null}
    </form>
  )
}
