import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { renderConceptMarkdown } from "../render/concept.js"
import { renderPrdMarkdown } from "../render/prd.js"
import type { AcceptanceCriterion, Concept, Item, PRD, Project, UserStory } from "../types.js"
import { resolveHarness, type RunLlmConfig } from "../llm/registry.js"
import { invokeHostedCli, parseJsonObject } from "../llm/hosted/hostedCliAdapter.js"
import type { HostedRequest } from "../llm/hosted/promptEnvelope.js"
import type { WorkflowContext } from "./workspaceLayout.js"
import { layout } from "./workspaceLayout.js"

export type PreparedImportBundle = {
  concept: Concept & { hasUi: boolean }
  projects: Project[]
  prdsByProjectId: Record<string, PRD>
  warnings: string[]
}

export type PreparedImportSeedResult = {
  projectStartStages: Record<string, "requirements" | "architecture">
  warnings: string[]
  sourceSnapshotPath?: string
}

type LlmNormalizedImport = {
  concept?: unknown
  projects?: unknown
  prdsByProjectId?: unknown
  warnings?: unknown
}

type JsonReadResult<T> = {
  exists: boolean
  malformed: boolean
  value: T | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => stringValue(item)).filter(Boolean)
  if (typeof value === "string") return value.split(/\r?\n/).map(line => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
  return []
}

function readJsonFile<T>(path: string): JsonReadResult<T> {
  if (!existsSync(path)) return { exists: false, malformed: false, value: null }
  try {
    return { exists: true, malformed: false, value: JSON.parse(readFileSync(path, "utf8")) as T }
  } catch {
    return { exists: true, malformed: true, value: null }
  }
}

function maybeConcept(value: unknown): Concept | null {
  if (!isRecord(value)) return null
  return {
    summary: stringValue(value.summary),
    problem: stringValue(value.problem),
    users: stringArray(value.users),
    constraints: stringArray(value.constraints),
  }
}

function maybeProject(value: unknown, index: number, fallbackConcept: Concept): Project | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id, `P${String(index + 1).padStart(2, "0")}`)
  const concept = maybeConcept(value.concept) ?? fallbackConcept
  return {
    id,
    name: stringValue(value.name, id),
    description: stringValue(value.description, concept.summary),
    concept,
    hasUi: value.hasUi === true,
  }
}

const ACCEPTANCE_PRIORITIES = new Set<AcceptanceCriterion["priority"]>(["must", "should", "could"])
const ACCEPTANCE_CATEGORIES = new Set<AcceptanceCriterion["category"]>(["functional", "validation", "error", "state", "ui"])

function maybeAcceptanceCriterion(value: unknown): AcceptanceCriterion | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const text = stringValue(value.text)
  if (!id || !text) return null
  const priority = ACCEPTANCE_PRIORITIES.has(value.priority as AcceptanceCriterion["priority"])
    ? value.priority as AcceptanceCriterion["priority"]
    : "must"
  const category = ACCEPTANCE_CATEGORIES.has(value.category as AcceptanceCriterion["category"])
    ? value.category as AcceptanceCriterion["category"]
    : "functional"
  return { id, text, priority, category }
}

function maybeStory(value: unknown): UserStory | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  if (!id) return null
  const acceptanceCriteria = Array.isArray(value.acceptanceCriteria)
    ? value.acceptanceCriteria
      .map(maybeAcceptanceCriterion)
      .filter((criterion): criterion is AcceptanceCriterion => Boolean(criterion))
    : []
  return {
    id,
    title: stringValue(value.title, id),
    description: typeof value.description === "string" ? value.description.trim() : undefined,
    acceptanceCriteria,
  }
}

function maybePrd(value: unknown): PRD | null {
  const raw = isRecord(value) && isRecord(value.prd) ? value.prd : value
  if (!isRecord(raw) || !Array.isArray(raw.stories)) return null
  const stories = raw.stories
    .map(maybeStory)
    .filter((story): story is UserStory => Boolean(story))
  return stories.length > 0 ? { stories } : null
}

function headingSection(markdown: string, heading: string): string {
  const escaped = heading.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  const match = new RegExp(String.raw`^##\s+${escaped}\s*\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))`, "im").exec(markdown)
  return match?.[1]?.trim() ?? ""
}

function firstHeading(markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? ""
}

function firstAvailableSection(markdown: string, headings: string[]): string {
  for (const heading of headings) {
    const section = headingSection(markdown, heading)
    if (section) return section
  }
  return ""
}

function linesFromSection(markdown: string, headings: string[]): string[] {
  const section = firstAvailableSection(markdown, headings)
  if (!section) return []
  const lines = section
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .filter(line => !/^#+\s+/.test(line))
  return lines.length > 0 ? lines : [section]
}

function conceptFromMarkdown(markdown: string, item: Pick<Item, "title" | "description">): Concept {
  const title = firstHeading(markdown).replace(/^PROJ-\d+\s*:\s*/i, "").trim()
  const summary = firstAvailableSection(markdown, ["Summary", "Ziel und Scope", "Ziel", "Scope"])
  return {
    summary: summary || title || item.title,
    problem: firstAvailableSection(markdown, ["Problem", "Ziel und Scope", "Funktionsumfang"]) || item.description || "",
    users: linesFromSection(markdown, ["Users", "Nutzer und Nutzungsszenario", "Nutzer"]),
    constraints: [
      ...linesFromSection(markdown, ["Constraints", "Qualitaet, Tests und Demo-Grenzen", "Demo-Grenzen"]),
      ...linesFromSection(markdown, ["Out of Scope"]).map(line => `Out of scope: ${line}`),
    ],
  }
}

function prdPrefixFromFile(path: string): string | null {
  const name = basename(path, extname(path))
  const match = /^(PROJ-\d+-PRD-\d+)/i.exec(name)
  return match?.[1]?.toUpperCase() ?? null
}

function nextSectionIndex(markdown: string, start: number): number {
  const match = /^##\s+/gm.exec(markdown.slice(start))
  return match?.index === undefined ? markdown.length : start + match.index
}

function prdFromMarkdown(markdown: string, options: { storyIdPrefix?: string } = {}): PRD | null {
  const stories: PRD["stories"] = []
  const storyPattern = /^###\s+(US-[\w-]+|Story\s+\d+)\s*:?\s*(.*)$/gim
  const matches = [...markdown.matchAll(storyPattern)]
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    const rawId = match[1].replace(/^Story\s+/i, "US-")
    const id = options.storyIdPrefix ? `${options.storyIdPrefix}-${rawId}` : rawId
    const title = (match[2] ?? "").trim() || id
    const start = (match.index ?? 0) + match[0].length
    const end = Math.min(matches[index + 1]?.index ?? markdown.length, nextSectionIndex(markdown, start))
    const body = markdown.slice(start, end)
    const acceptanceCriteria = [...body.matchAll(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?((?:AC|ac)-[A-Za-z0-9_.-]+)\s*:?\s*(.+)$/gm)]
      .map(ac => ({
        id: ac[1],
        text: ac[2].trim(),
        priority: "must" as const,
        category: "functional" as const,
      }))
    stories.push({ id, title, description: body.trim(), acceptanceCriteria })
  }
  return stories.length > 0 ? { stories } : null
}

function collectFiles(root: string): string[] {
  const entries = readdirSync(root).map(name => join(root, name))
  return entries.flatMap(path => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return []
    if (stat.isDirectory()) return collectFiles(path)
    return stat.isFile() ? [path] : []
  })
}

function markdownFiles(root: string): Array<{ path: string; content: string }> {
  return collectFiles(root)
    .filter(path => extname(path).toLowerCase() === ".md")
    .map(path => ({ path, content: readFileSync(path, "utf8") }))
}

function hasUiSignal(sourceDir: string, files: string[]): boolean {
  return files.some(file => {
    const rel = relative(sourceDir, file).split(sep).join("/")
    return /^5_mockups\//i.test(rel) || /^2_visual-companion\//i.test(rel) || /mockup|sitemap|wireframe/i.test(rel)
  })
}

function projectIdFromFolder(sourceDir: string): string | null {
  return /^(PROJ-\d+)(?:-|$)/i.exec(basename(sourceDir))?.[1] ?? null
}

function projectIdFromConcept(markdown: string): string | null {
  return /\b(PROJ-\d+)\b/i.exec(firstHeading(markdown))?.[1] ?? null
}

function projectNameFromConcept(markdown: string, fallback: string): string {
  const h1 = firstHeading(markdown)
  if (!h1) return fallback
  return h1.replace(/^PROJ-\d+\s*:\s*/i, "").trim() || fallback
}

function projectIdFromPrdFile(path: string): string | null {
  const name = basename(path, extname(path))
  const cleaned = name.replace(/\.prd$/i, "")
  if (/^prd$/i.test(cleaned) || /^requirements$/i.test(cleaned)) return null
  const projMatch = /^(PROJ-\d+)(?:-|$)/i.exec(cleaned)
  return projMatch?.[1] ?? cleaned
}

function mergePrd(existing: PRD | undefined, incoming: PRD): PRD {
  if (!existing) return incoming
  const stories = [...existing.stories]
  const idCounts = new Map<string, number>()
  for (const story of stories) {
    idCounts.set(story.id, (idCounts.get(story.id) ?? 0) + 1)
  }
  for (const story of incoming.stories) {
    const existingCount = idCounts.get(story.id) ?? 0
    if (existingCount > 0) {
      const nextCount = existingCount + 1
      stories.push({ ...story, id: `${story.id}-${nextCount}` })
      idCounts.set(story.id, nextCount)
    } else {
      stories.push(story)
      idCounts.set(story.id, 1)
    }
  }
  return { stories }
}

function setPrd(prdsByProjectId: Record<string, PRD>, projectId: string, prd: PRD): void {
  prdsByProjectId[projectId] = mergePrd(prdsByProjectId[projectId], prd)
}

function isPrdJsonFile(sourceDir: string, file: string, base: string): boolean {
  const rel = relative(sourceDir, file).split(sep).join("/")
  return base === "prd.json" || base.endsWith(".prd.json") || /^prds\//i.test(rel) || /^3_PRDs\//i.test(rel)
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel)
}

function relativeImportPath(sourceDir: string, file: string): string {
  return relative(sourceDir, file).split(sep).join("/")
}

export function deriveProjectStartStages(bundle: PreparedImportBundle): Record<string, "requirements" | "architecture"> {
  return Object.fromEntries(
    bundle.projects.map(project => [
      project.id,
      bundle.prdsByProjectId[project.id]?.stories.length ? "architecture" : "requirements",
    ]),
  ) as Record<string, "requirements" | "architecture">
}

function loadConceptFromSource(
  sourceDir: string,
  item: Pick<Item, "title" | "description">,
  files: string[],
  warnings: string[],
): { concept: Concept & { hasUi: boolean }; markdownConcept: string; inferredHasUi: boolean } {
  const conceptJson = readJsonFile<unknown>(join(sourceDir, "concept.json"))
  if (conceptJson.malformed) {
    warnings.push("concept.json present but unparseable; fell back to markdown or item metadata.")
  }
  const markdownConceptFile =
    files.find(path => /(?:^|\/)1_brainstorm\/.*concept.*\.md$/i.test(path)) ??
    files.find(path => path.toLowerCase().endsWith("concept.md")) ??
    files.find(path => extname(path).toLowerCase() === ".md")
  const markdownConcept = markdownConceptFile ? readFileSync(markdownConceptFile, "utf8") : ""
  const fallbackConcept = markdownConceptFile
    ? conceptFromMarkdown(markdownConcept, item)
    : { summary: item.title, problem: item.description ?? "", users: [], constraints: [] }
  const inferredHasUi = hasUiSignal(sourceDir, files)
  const concept = { ...(maybeConcept(conceptJson.value) ?? fallbackConcept), hasUi: inferredHasUi }
  return { concept, markdownConcept, inferredHasUi }
}

function loadProjectsFromJson(
  sourceDir: string,
  concept: Concept,
  warnings: string[],
): Project[] {
  const projectsJson = readJsonFile<unknown>(join(sourceDir, "projects.json"))
  if (projectsJson.malformed) {
    warnings.push("projects.json present but unparseable; inferred projects from prepared artifacts.")
    return []
  }
  if (projectsJson.exists && !Array.isArray(projectsJson.value)) {
    warnings.push("projects.json present but not an array; inferred projects from prepared artifacts.")
    return []
  }
  return Array.isArray(projectsJson.value)
    ? projectsJson.value.map((project, index) => maybeProject(project, index, concept)).filter((project): project is Project => Boolean(project))
    : []
}

function setJsonPrd(
  sourceDir: string,
  file: string,
  projects: Project[],
  prdsByProjectId: Record<string, PRD>,
  warnings: string[],
): void {
  const raw = readJsonFile<unknown>(file)
  const prd = maybePrd(raw.value)
  if (!prd) {
    const reason = raw.malformed ? "unparseable JSON" : "no valid stories"
    warnings.push(`ignored PRD JSON (${reason}): ${relativeImportPath(sourceDir, file)}`)
    return
  }
  const projectId = projectIdFromPrdFile(file) ?? projects[0]?.id ?? projectIdFromFolder(sourceDir) ?? "P01"
  setPrd(prdsByProjectId, projectId, prd)
}

function setMarkdownPrd(
  sourceDir: string,
  file: string,
  projects: Project[],
  prdsByProjectId: Record<string, PRD>,
): void {
  const prd = prdFromMarkdown(readFileSync(file, "utf8"), { storyIdPrefix: prdPrefixFromFile(file) ?? undefined })
  if (!prd) return
  const projectId = projectIdFromPrdFile(file) ?? projects[0]?.id ?? projectIdFromFolder(sourceDir) ?? "P01"
  setPrd(prdsByProjectId, projectId, prd)
}

function loadPrdsFromFiles(
  sourceDir: string,
  files: string[],
  projects: Project[],
  warnings: string[],
): Record<string, PRD> {
  const prdsByProjectId: Record<string, PRD> = {}
  for (const file of files) {
    const ext = extname(file).toLowerCase()
    const base = basename(file).toLowerCase()
    if (ext === ".json" && isPrdJsonFile(sourceDir, file, base)) {
      setJsonPrd(sourceDir, file, projects, prdsByProjectId, warnings)
    }
    if (ext === ".md" && !base.endsWith("concept.md")) {
      setMarkdownPrd(sourceDir, file, projects, prdsByProjectId)
    }
  }
  return prdsByProjectId
}

function inferProjectsFromArtifacts(
  sourceDir: string,
  markdownConcept: string,
  concept: Concept,
  prdsByProjectId: Record<string, PRD>,
  inferredHasUi: boolean,
): Project[] {
  const projectIds = Object.keys(prdsByProjectId)
  const inferredProjectId = projectIdFromFolder(sourceDir) ?? projectIdFromConcept(markdownConcept)
  const ids = projectIds.length > 0 ? projectIds : [inferredProjectId ?? "P01"]
  return ids.map(id => ({
    id,
    name: id === inferredProjectId && markdownConcept ? projectNameFromConcept(markdownConcept, id) : id,
    description: concept.summary,
    concept,
    hasUi: inferredHasUi,
  }))
}

function addProjectsFromPrdFilenames(
  projects: Project[],
  prdsByProjectId: Record<string, PRD>,
  concept: Concept,
  inferredHasUi: boolean,
  warnings: string[],
): Project[] {
  const knownProjectIds = new Set(projects.map(project => project.id))
  for (const projectId of Object.keys(prdsByProjectId)) {
    if (knownProjectIds.has(projectId)) continue
    projects.push({ id: projectId, name: projectId, description: concept.summary, concept, hasUi: inferredHasUi })
    warnings.push(`created project from PRD filename: ${projectId}`)
  }
  return projects
}

export function loadPreparedImportBundle(
  sourceDir: string,
  item: Pick<Item, "title" | "description">,
): PreparedImportBundle {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`prepared import source is not a readable directory: ${sourceDir}`)
  }

  const warnings: string[] = []
  const files = collectFiles(sourceDir)
  const { concept, markdownConcept, inferredHasUi } = loadConceptFromSource(sourceDir, item, files, warnings)
  let projects = loadProjectsFromJson(sourceDir, concept, warnings)
  const prdsByProjectId = loadPrdsFromFiles(sourceDir, files, projects, warnings)

  if (projects.length === 0) {
    projects = inferProjectsFromArtifacts(sourceDir, markdownConcept, concept, prdsByProjectId, inferredHasUi)
  }

  projects = addProjectsFromPrdFilenames(projects, prdsByProjectId, concept, inferredHasUi, warnings)
  projects = projects.map(project => ({ ...project, hasUi: project.hasUi === true || inferredHasUi }))

  return { concept: { ...concept, hasUi: projects.some(project => project.hasUi === true) }, projects, prdsByProjectId, warnings }
}

function needsLlmFallback(bundle: PreparedImportBundle, sourceDir: string): boolean {
  if (markdownFiles(sourceDir).length === 0) return false
  return bundle.projects.some(project => !bundle.prdsByProjectId[project.id]?.stories.length)
}

function normalizedPrds(value: unknown): Record<string, PRD> {
  if (!isRecord(value)) return {}
  const out: Record<string, PRD> = {}
  for (const [projectId, raw] of Object.entries(value)) {
    const prd = maybePrd(raw)
    if (prd?.stories.length) out[projectId] = prd
  }
  return out
}

function normalizedProjects(value: unknown, fallbackConcept: Concept): Project[] {
  if (!Array.isArray(value)) return []
  return value
    .map((project, index) => maybeProject(project, index, fallbackConcept))
    .filter((project): project is Project => Boolean(project))
}

function mergeLlmNormalizedBundle(
  current: PreparedImportBundle,
  normalized: LlmNormalizedImport,
): PreparedImportBundle {
  const concept = maybeConcept(normalized.concept) ?? current.concept
  const projects = normalizedProjects(normalized.projects, concept)
  const prdsByProjectId = normalizedPrds(normalized.prdsByProjectId)
  const warnings = Array.isArray(normalized.warnings)
    ? normalized.warnings.map(warning => stringValue(warning)).filter(Boolean)
    : []
  return {
    concept: { ...concept, hasUi: (projects.length > 0 ? projects : current.projects).some(project => project.hasUi === true) },
    projects: projects.length > 0 ? projects : current.projects,
    prdsByProjectId: { ...current.prdsByProjectId, ...prdsByProjectId },
    warnings: [...current.warnings, ...warnings],
  }
}

export async function loadPreparedImportBundleWithLlmFallback(
  sourceDir: string,
  item: Pick<Item, "title" | "description">,
  llm?: RunLlmConfig,
): Promise<PreparedImportBundle> {
  const parsed = loadPreparedImportBundle(sourceDir, item)
  if (!llm || !needsLlmFallback(parsed, sourceDir)) return parsed

  const harness = resolveHarness({ ...llm, role: "coder", stage: "requirements" })
  if (harness.kind === "fake") return parsed
  const runtime: HostedRequest["runtime"] = {
    harness: harness.harness,
    runtime: harness.runtime,
    provider: harness.provider,
    model: harness.model,
    workspaceRoot: sourceDir,
    policy: { mode: "no-tools" },
  }
  const files = markdownFiles(sourceDir).map(file => ({ ...file, relativePath: relativeImportPath(sourceDir, file.path) }))
  const prompt = [
    "Normalize prepared product artifacts for beerengineer_.",
    "Return exactly one JSON object, no markdown fences, no prose.",
    "Shape:",
    "{",
    '  "concept": { "summary": string, "problem": string, "users": string[], "constraints": string[], "hasUi"?: boolean },',
    '  "projects": [{ "id": string, "name": string, "description": string, "concept": Concept, "hasUi"?: boolean }],',
    '  "prdsByProjectId": { "<projectId>": { "stories": [{ "id": string, "title": string, "description"?: string, "acceptanceCriteria": [{ "id": string, "text": string, "priority": "must"|"should"|"could", "category": "functional"|"validation"|"error"|"state"|"ui" }] }] } },',
    '  "warnings": string[]',
    "}",
    "Preserve existing project ids when they are present. If a PRD cannot be confidently assigned, omit it and add a warning.",
    "",
    `Item title: ${item.title}`,
    `Item description: ${item.description ?? ""}`,
    "",
    "Current best-effort parse:",
    JSON.stringify(parsed, null, 2),
    "",
    "Markdown files:",
    ...files.flatMap(file => [`--- ${file.relativePath}`, file.content.slice(0, 20000)]),
  ].join("\n")
  try {
    const result = await invokeHostedCli(
      { kind: "stage", runtime, prompt, payload: { item, files: files.map(file => file.relativePath) } },
      { harness: harness.harness, sessionId: null },
    )
    return mergeLlmNormalizedBundle(parsed, parseJsonObject(result.outputText) as LlmNormalizedImport)
  } catch (error) {
    return {
      ...parsed,
      warnings: [...parsed.warnings, `LLM normalization fallback failed: ${(error as Error).message}`],
    }
  }
}

export function projectPrdFileName(projectId: string): string {
  return `prd.${projectId.toLowerCase().replaceAll(/[^a-z0-9-]+/g, "-")}.json`
}

export function preparedImportSourceSnapshotDir(context: WorkflowContext): string {
  return join(layout.runDir(context), "imports", "prepared-source")
}

function snapshotPreparedImportSource(context: WorkflowContext, sourceDir: string | undefined): string | undefined {
  if (!sourceDir) return undefined
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`prepared import source is not a readable directory: ${sourceDir}`)
  }
  const source = resolve(sourceDir)
  const target = preparedImportSourceSnapshotDir(context)
  const resolvedTarget = resolve(target)
  if (source === resolvedTarget) return target
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, {
    recursive: true,
    filter: path => {
      const resolvedPath = resolve(path)
      if (resolvedPath === resolvedTarget || isPathInside(resolvedTarget, resolvedPath)) return false
      try {
        if (lstatSync(resolvedPath).isSymbolicLink()) return false
      } catch {
        return false
      }
      return ![".git", ".beerengineer"].includes(basename(resolvedPath))
    },
  })
  writeFileSync(
    join(target, ".beerengineer-import.json"),
    JSON.stringify({ sourceDir: source, copiedAt: new Date().toISOString() }, null, 2),
  )
  return target
}

export function seedPreparedImportArtifacts(
  context: WorkflowContext,
  bundle: PreparedImportBundle,
  options: { sourceDir?: string } = {},
): PreparedImportSeedResult {
  const sourceSnapshotPath = snapshotPreparedImportSource(context, options.sourceDir)
  const brainstormDir = layout.stageArtifactsDir(context, "brainstorm")
  mkdirSync(brainstormDir, { recursive: true })
  writeFileSync(join(brainstormDir, "concept.json"), JSON.stringify(bundle.concept, null, 2))
  writeFileSync(join(brainstormDir, "projects.json"), JSON.stringify(bundle.projects, null, 2))
  writeFileSync(join(brainstormDir, "concept.md"), renderConceptMarkdown(bundle.concept))

  const requirementsDir = layout.stageArtifactsDir(context, "requirements")
  mkdirSync(requirementsDir, { recursive: true })
  const projectStartStages = deriveProjectStartStages(bundle)
  for (const project of bundle.projects) {
    const prd = bundle.prdsByProjectId[project.id]
    if (projectStartStages[project.id] !== "architecture" || !prd) continue
    const artifact = { concept: project.concept, prd }
    writeFileSync(join(requirementsDir, projectPrdFileName(project.id)), JSON.stringify(artifact, null, 2))
    writeFileSync(join(requirementsDir, `prd.${project.id.toLowerCase().replaceAll(/[^a-z0-9-]+/g, "-")}.md`), renderPrdMarkdown(artifact))
  }

  const firstReadyProject = bundle.projects.find(project => projectStartStages[project.id] === "architecture")
  if (firstReadyProject) {
    const prd = bundle.prdsByProjectId[firstReadyProject.id]
    writeFileSync(join(requirementsDir, "prd.json"), JSON.stringify({ concept: firstReadyProject.concept, prd }, null, 2))
  }

  return { projectStartStages, warnings: bundle.warnings, sourceSnapshotPath }
}
