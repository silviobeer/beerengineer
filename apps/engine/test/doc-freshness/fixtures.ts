import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export interface DirectoryReferenceWordingFixture {
  name: string
  docPath: string
  reference: string
  context: "current" | "historical"
}

export const DIRECTORY_REFERENCE_WORDING_FIXTURES: readonly DirectoryReferenceWordingFixture[] = [
  {
    name: "canonical-docs-home",
    docPath: "README.md",
    reference: "docs/",
    context: "current",
  },
  {
    name: "engine-source-home",
    docPath: "docs/AGENTS.md",
    reference: "../apps/engine/",
    context: "current",
  },
  {
    name: "script-directory-home",
    docPath: "docs/TECHNICAL.md",
    reference: "../scripts/",
    context: "current",
  },
  {
    name: "retired-legacy-docs-home",
    docPath: "AGENTS.md",
    reference: "docs/legacy/",
    context: "historical",
  },
  {
    name: "retired-ui-subtree",
    docPath: "docs/PROJECT.md",
    reference: "../legacy/ui/",
    context: "historical",
  },
  {
    name: "retired-runtime-scripts",
    docPath: "docs/TECHNICAL.md",
    reference: "../old-runtime/",
    context: "historical",
  },
] as const

export const DOC_FRESHNESS_FIXTURE_DOCS: Readonly<Record<string, string>> = {
  "README.md": [
    "# Fixture Repo",
    "",
    "Start at `docs/` for the canonical project guidance.",
    "The setup examples use `typescript@^5.8.3` today.",
    "",
  ].join("\n"),
  "AGENTS.md": [
    "# Fixture Agents",
    "",
    "Historical note: `docs/legacy/` used to hold the decision index.",
    "",
  ].join("\n"),
  "docs/AGENTS.md": [
    "# Engine Docs Guide",
    "",
    "Use `../apps/engine/` for the engine runtime source tree.",
    "",
  ].join("\n"),
  "docs/PROJECT.md": [
    "# Project Index",
    "",
    "Completed work includes PROJ-10 in the shipped catalog.",
    "Completed work includes PROJ-12 in the shipped catalog.",
    "Historical note: `../legacy/ui/` was removed after the rewrite.",
    "",
  ].join("\n"),
  "docs/TECHNICAL.md": [
    "# Technical Guide",
    "",
    "Operational scripts currently live under `../scripts/`.",
    "Older experiments in `../old-runtime/` were removed.",
    "",
  ].join("\n"),
  "apps/ui/README.md": [
    "# UI Workspace",
    "",
    "Current UI routes live under `app/`.",
    "",
  ].join("\n"),
  "apps/engine/docs/AGENTS.md": [
    "# Engine Docs Guide",
    "",
    "Start at `../../../docs/` for cross-cutting docs.",
    "",
  ].join("\n"),
  "apps/ui/docs/AGENTS.md": [
    "# UI Docs Guide",
    "",
    "Open `../../../apps/ui/` for the active UI workspace.",
    "",
  ].join("\n"),
  "docs/adr/ADR-12-1.md": [
    "# ADR-12-1",
    "",
    "Canonical ADRs live under `../` inside the docs tree.",
    "",
  ].join("\n"),
} as const

export const DOC_FRESHNESS_FIXTURE_MANIFESTS: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify(
    {
      name: "fixture-root",
      private: true,
      devDependencies: {
        typescript: "^5.8.3",
      },
    },
    null,
    2,
  ),
  "apps/engine/package.json": JSON.stringify(
    {
      name: "@fixture/engine",
      private: true,
      dependencies: {
        "@openai/codex-sdk": "^0.125.0",
      },
    },
    null,
    2,
  ),
  "apps/ui/package.json": JSON.stringify(
    {
      name: "@fixture/ui",
      private: true,
      dependencies: {
        next: "15.3.0",
      },
    },
    null,
    2,
  ),
  "apps/worker/package.json": JSON.stringify(
    {
      name: "@fixture/worker",
      private: true,
      dependencies: {
        hono: "^4.7.0",
      },
    },
    null,
    2,
  ),
} as const

export function writeDocFreshnessFixtureRepo(rootPath: string): void {
  const directories = [
    "apps/engine/src",
    "apps/ui/app",
    "apps/worker/src",
    "apps/engine/docs",
    "apps/ui/docs",
    "docs/adr",
    "scripts",
    "skills",
    "specs/PROJ-10-shipped-foundation/7_progress",
    "specs/PROJ-12-canonical-adr-home/7_progress",
  ]

  for (const directoryPath of directories) {
    mkdirSync(join(rootPath, directoryPath), { recursive: true })
  }

  for (const [relativePath, content] of Object.entries(DOC_FRESHNESS_FIXTURE_DOCS)) {
    writeRepoFile(rootPath, relativePath, content)
  }

  for (const [relativePath, content] of Object.entries(DOC_FRESHNESS_FIXTURE_MANIFESTS)) {
    writeRepoFile(rootPath, relativePath, `${content}\n`)
  }

  writeRepoFile(
    rootPath,
    "specs/PROJ-10-shipped-foundation/7_progress/2026-05-10.md",
    "# Progress\n\nShipped.\n",
  )
  writeRepoFile(
    rootPath,
    "specs/PROJ-12-canonical-adr-home/7_progress/2026-05-11.md",
    "# Progress\n\nShipped.\n",
  )
}

function writeRepoFile(rootPath: string, relativePath: string, content: string): void {
  const absolutePath = join(rootPath, relativePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content, "utf8")
}
