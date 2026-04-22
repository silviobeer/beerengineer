import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export function reviewCycleArtifactsDir(baseDir: string, reviewCycle: number): string {
  return join(baseDir, "review-tool-artifacts", `cycle-${reviewCycle}`)
}

export async function writeArtifactText(dir: string, name: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, content, "utf8")
  return path
}

export async function writeArtifactJson(dir: string, name: string, value: unknown): Promise<string> {
  return writeArtifactText(dir, name, `${JSON.stringify(value, null, 2)}\n`)
}
