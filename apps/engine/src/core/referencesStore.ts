import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { layout, type WorkflowContext } from "./workspaceLayout.js"
import type { ReferenceInput, SourceFile } from "../types/domain.js"

function stageReferenceDir(ctx: WorkflowContext, bucket: "wireframes" | "design"): string {
  return join(layout.runDir(ctx), "references", "design-prep", bucket)
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "reference"
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^figma:\/\//i.test(value)
}

export function resolveReferences(
  ctx: WorkflowContext,
  bucket: "wireframes" | "design",
  references: ReferenceInput[] | undefined,
): SourceFile[] {
  if (!references || references.length === 0) return []
  const outDir = stageReferenceDir(ctx, bucket)
  mkdirSync(outDir, { recursive: true })

  return references.map((reference, index) => {
    const value = reference.value.trim()
    const description = reference.description?.trim() || `Reference ${index + 1}`
    if (looksLikeUrl(value)) {
      const type = /figma/i.test(value) ? "figma" : "url"
      return { type, url: value, description } satisfies SourceFile
    }

    const absolute = isAbsolute(value)
      ? value
      : ctx.workspaceRoot
      ? resolve(ctx.workspaceRoot, value)
      : resolve(process.cwd(), value)
    const workspaceRelative =
      ctx.workspaceRoot && absolute.startsWith(resolve(ctx.workspaceRoot) + "/")
        ? relative(ctx.workspaceRoot, absolute)
        : null
    if (workspaceRelative) {
      return { type: "file", path: workspaceRelative, description }
    }

    const targetName = `${index + 1}-${sanitizeName(absolute.split("/").pop() ?? "reference")}`
    const target = join(outDir, targetName)
    if (existsSync(absolute)) copyFileSync(absolute, target)
    return { type: "file", path: relative(process.cwd(), target), description }
  })
}

