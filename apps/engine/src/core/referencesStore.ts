import { existsSync, mkdirSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { layout, type WorkflowContext } from "./workspaceLayout.js"
import type { ReferenceInput, SourceFile } from "../types/domain.js"

function stageReferenceDir(ctx: WorkflowContext, bucket: "wireframes" | "design"): string {
  return join(layout.runDir(ctx), "references", "design-prep", bucket)
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^figma:\/\//i.test(value)
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root)
  return candidate === normalizedRoot || candidate.startsWith(normalizedRoot + sep)
}

// Resolve reference inputs into a serializable manifest. To avoid exfiltrating
// arbitrary files into the workspace, paths are required to live under the
// workspace root; anything else is recorded as `missing` rather than copied.
export function resolveReferences(
  ctx: WorkflowContext,
  bucket: "wireframes" | "design",
  references: ReferenceInput[] | undefined,
): SourceFile[] {
  if (!references || references.length === 0) return []
  mkdirSync(stageReferenceDir(ctx, bucket), { recursive: true })

  return references.map((reference, index) => {
    const value = reference.value.trim()
    const description = reference.description?.trim() || `Reference ${index + 1}`
    if (looksLikeUrl(value)) {
      const type = /figma/i.test(value) ? "figma" : "url"
      return { type, url: value, description } satisfies SourceFile
    }

    const workspaceRoot = ctx.workspaceRoot ? resolve(ctx.workspaceRoot) : null
    const absolute = isAbsolute(value)
      ? resolve(value)
      : resolve(workspaceRoot ?? process.cwd(), value)

    if (!workspaceRoot) {
      return { type: "file", path: relative(process.cwd(), absolute), description }
    }

    if (!isInside(workspaceRoot, absolute)) {
      // Refuse to stage files from outside the workspace. Record the intent
      // so reviewers can see the rejection without leaking absolute paths.
      return {
        type: "file",
        path: "(rejected: outside workspace root)",
        description: `${description} [rejected]`,
      }
    }

    const workspaceRelative = relative(workspaceRoot, absolute)
    const payload: SourceFile = { type: "file", path: workspaceRelative, description }
    return existsSync(absolute)
      ? payload
      : { ...payload, description: `${description} [missing]` }
  })
}
