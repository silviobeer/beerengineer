import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import ts from "typescript"

type OwnershipEvidence = {
  storyId: string
  capabilityOwner: string
  allowlist: Array<{ path: string; reason: string }>
  exemptions: Array<{ path: string; reason: string }>
  verifiedSurfaces: Array<{ id: string; path: string; via: string; verification: string }>
}

type OwnershipReport = {
  importers: string[]
  directCallers: Array<{ path: string; calls: string[] }>
}

const engineTestDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(engineTestDir, "..", "..", "..")
const engineRoot = resolve(repoRoot, "apps/engine")
const runOrchestratorPath = resolve(engineRoot, "src/core/runOrchestrator.ts")
const evidencePath = resolve(engineRoot, "test/fixtures/orchestrator-ownership-evidence.json")

function normalizeRepoPath(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/")
}

function readOwnershipEvidence(): OwnershipEvidence {
  return JSON.parse(readFileSync(evidencePath, "utf8")) as OwnershipEvidence
}

function makeRepoTempDir(prefix: string): string {
  const base = resolve(repoRoot, ".tmp")
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, prefix))
}

function fixtureImportSpecifier(fromFile: string): string {
  const specifier = relative(dirname(fromFile), runOrchestratorPath).replace(/\\/g, "/").replace(/\.ts$/, ".js")
  return specifier.startsWith(".") ? specifier : `./${specifier}`
}

function listEngineSourceFiles(dir: string): string[] {
  const entries = ts.sys.readDirectory(dir, [".ts"], undefined, ["**/*.ts"])
  return entries.filter(path => !path.endsWith(".d.ts"))
}

function callTargetForExpression(checker: ts.TypeChecker, expression: ts.LeftHandSideExpression): string | null {
  const target = ts.isPropertyAccessExpression(expression) ? expression.name : expression
  if (!ts.isIdentifier(target)) return null
  const raw = checker.getSymbolAtLocation(target)
  if (!raw) return null
  const symbol = raw.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(raw) : raw
  const declaration = symbol.declarations?.[0]
  if (!declaration) return null
  if (resolve(declaration.getSourceFile().fileName) !== runOrchestratorPath) return null
  const name = symbol.getName()
  return name === "prepareRun" || name === "runWorkflowWithSync" ? name : null
}

function analyzeOwnership(extraFiles: string[] = []): OwnershipReport {
  const sourceFiles = [...listEngineSourceFiles(resolve(engineRoot, "src")), ...extraFiles]
  const includedExtraFiles = new Set(extraFiles.map(path => resolve(path)))
  const compilerOptions: ts.CompilerOptions = {
    allowJs: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
  }
  const host = ts.createCompilerHost(compilerOptions, true)
  const program = ts.createProgram(sourceFiles, compilerOptions, host)
  const checker = program.getTypeChecker()
  const importers = new Set<string>()
  const directCallers = new Map<string, Set<string>>()

  for (const sourceFile of program.getSourceFiles()) {
    const filename = resolve(sourceFile.fileName)
    if (filename === runOrchestratorPath) continue
    if (!filename.startsWith(resolve(engineRoot, "src")) && !includedExtraFiles.has(filename)) continue

    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = ts.resolveModuleName(
          node.moduleSpecifier.text,
          sourceFile.fileName,
          compilerOptions,
          host,
        ).resolvedModule?.resolvedFileName
        if (resolved && resolve(resolved) === runOrchestratorPath) {
          importers.add(normalizeRepoPath(filename))
        }
      }

      if (ts.isCallExpression(node)) {
        const target = callTargetForExpression(checker, node.expression)
        if (target) {
          const path = normalizeRepoPath(filename)
          const calls = directCallers.get(path) ?? new Set<string>()
          calls.add(target)
          directCallers.set(path, calls)
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return {
    importers: [...importers].sort(),
    directCallers: [...directCallers.entries()]
      .map(([path, calls]) => ({ path, calls: [...calls].sort() }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  }
}

function writeFixtureModule(dir: string, relativePath: string, source: string): string {
  const fullPath = join(dir, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, source)
  return fullPath
}

test("PROJ-8-PRD-2-US-5 TC-02: allowlist accepts only explicitly reviewed orchestrator callers", () => {
  assert.equal(existsSync(evidencePath), true, `${normalizeRepoPath(evidencePath)} must be committed for review`)
  const evidence = readOwnershipEvidence()
  const report = analyzeOwnership()
  const allowlisted = evidence.allowlist.map(entry => entry.path).sort()

  assert.equal(evidence.storyId, "PROJ-8-PRD-2-US-5")
  assert.equal(evidence.capabilityOwner, "apps/engine/src/core/runService.ts")
  assert.deepEqual(report.importers, allowlisted)
  assert.deepEqual(report.directCallers, [{ path: "apps/engine/src/core/runService.ts", calls: ["prepareRun"] }])
  for (const entry of [...evidence.allowlist, ...evidence.exemptions]) {
    assert.match(entry.reason, /\S/, `${entry.path} must include a human-readable review reason`)
    assert.equal(entry.path.includes("*"), false, `${entry.path} must not use wildcard allowlisting`)
  }
})

test("PROJ-8-PRD-2-US-5 TC-01: ImportGraphGuard rejects any unallowlisted importer of core/runOrchestrator", () => {
  const tmp = makeRepoTempDir("be2-import-guard-")
  try {
    const fixture = writeFixtureModule(tmp, "apps/engine/src/rogue/importer.ts", "")
    writeFileSync(
      fixture,
      `import { prepareRun } from "${fixtureImportSpecifier(fixture)}"\nexport function callIt() { return prepareRun }\n`,
    )
    const report = analyzeOwnership([fixture])
    assert.ok(report.importers.includes(normalizeRepoPath(fixture)))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("PROJ-8-PRD-2-US-5 TC-24-2: ImportGraphGuard rejects unreviewed barrel or aliased import paths to the orchestrator entrypoint", () => {
  const tmp = makeRepoTempDir("be2-barrel-call-")
  try {
    const barrel = writeFixtureModule(tmp, "apps/engine/src/rogue/orchestrator-barrel.ts", "")
    writeFileSync(
      barrel,
      `export { prepareRun, runWorkflowWithSync } from "${fixtureImportSpecifier(barrel)}"\n`,
    )
    const fixture = writeFixtureModule(tmp, "apps/engine/src/rogue/barrel-caller.ts", "")
    writeFileSync(
      fixture,
      `import { prepareRun, runWorkflowWithSync } from "./orchestrator-barrel.js"\nexport function badCalls(item, repos, io) {\n  prepareRun(item, repos, io)\n  return runWorkflowWithSync(item, repos, io)\n}\n`,
    )
    const report = analyzeOwnership([barrel, fixture])
    assert.deepEqual(
      report.directCallers.find(entry => entry.path === normalizeRepoPath(fixture)),
      { path: normalizeRepoPath(fixture), calls: ["prepareRun", "runWorkflowWithSync"] },
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("PROJ-8-PRD-2-US-5 TC-04 and TC-05: direct prepareRun and runWorkflowWithSync callers are blocked unless exempted", () => {
  const tmp = makeRepoTempDir("be2-direct-call-")
  try {
    const fixture = writeFixtureModule(tmp, "apps/engine/src/rogue/direct-caller.ts", "")
    writeFileSync(
      fixture,
      `import * as orchestrator from "${fixtureImportSpecifier(fixture)}"\nexport function badCalls(item, repos, io) {\n  orchestrator.prepareRun(item, repos, io)\n  return orchestrator.runWorkflowWithSync(item, repos, io)\n}\n`,
    )
    const report = analyzeOwnership([fixture])
    assert.deepEqual(
      report.directCallers.find(entry => entry.path === normalizeRepoPath(fixture)),
      { path: normalizeRepoPath(fixture), calls: ["prepareRun", "runWorkflowWithSync"] },
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("PROJ-8-PRD-2-US-5 TC-07 and TC-08: completion evidence enumerates every verified surface and every exemption reason", () => {
  const evidence = readOwnershipEvidence()
  const requiredSurfaces = [
    "cli_fresh_start",
    "api_post_runs",
    "api_item_action",
    "cli_item_action",
    "cli_import_prepared",
    "api_prepared_import",
    "api_resume",
    "cli_resume",
    "api_supabase_readiness_retry",
  ].sort()

  assert.deepEqual(
    evidence.verifiedSurfaces.map(surface => surface.id).sort(),
    requiredSurfaces,
  )
  for (const surface of evidence.verifiedSurfaces) {
    assert.equal(surface.via, evidence.capabilityOwner, `${surface.id} must document the reviewed owner path`)
    assert.equal(surface.verification, "ownership_parity", `${surface.id} must record parity review evidence`)
    assert.equal(existsSync(resolve(repoRoot, surface.path)), true, `${surface.path} must exist`)
  }
  for (const exemption of evidence.exemptions) {
    assert.match(exemption.reason, /\S/, `${exemption.path} must include a human-readable review reason`)
  }
})
