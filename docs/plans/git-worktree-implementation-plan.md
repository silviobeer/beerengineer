# Git Worktree Implementation Plan

## 1. Ziel

Den bestehenden Git-Branch-Bookkeeping-Layer zu einer vollstaendigen engine-owned
Git-Isolation ausbauen.

Heute:
- Die Engine erstellt Branches als leere Zeiger
- Agents committen nicht auf den zugewiesenen Branch, weil sie ihn nie ausgecheckt haben
- Kein Merge nach Story-Completion
- Parallele Stories koennen sich gegenseitig behindern (gleiches Working Directory)
- `GitBranchMetadata` hat `headBefore`/`headAfter`, aber kein Merge-Resultat

Ziel:
- Engine erstellt Worktree pro Story, Agent arbeitet isoliert darin
- `workspaceRoot` im `AdapterRuntimeContext` zeigt auf den Worktree-Pfad
- Agent commitet in seinen Worktree (normaler git-Workflow)
- Engine merged Story-Branch in Proj-Branch nach bestandenem Review
- Worktree wird nach Merge bereinigt
- Remediation bekommt eigenen Worktree auf Fix-Branch

## 2. Ausgangslage

### Was bereits existiert

`GitWorkflowService` (`src/services/git-workflow-service.ts`):
- Branch-Naming: `proj/{code}`, `story/{p}/{s}`, `fix/{s}/{n}`
- `ensureProjectBranch`, `ensureStoryBranch`, `ensureStoryRemediationBranch`
- `ensureBranchRef`: erstellt Branch via `git branch <name> <baseRef>`
- Dirty-Check via `git status --porcelain`
- Fallback auf `strategy: "simulated"` wenn Repo dirty oder kein git
- `:(exclude).beerengineer` bereits im Dirty-Check

`GitBranchMetadata` (`src/domain/types.ts`):
- `branchRole`, `branchName`, `baseRef`, `workspaceRoot`
- `headBefore`, `headAfter`, `commitSha`
- `mergedIntoRef`, `mergedCommitSha`
- `strategy: "applied" | "simulated"`

DB-Felder auf `WaveStoryExecution`:
- `gitBranchName`, `gitBaseRef`, `gitMetadataJson`

### Was fehlt

- `worktreePath` in `GitBranchMetadata` und DB
- `worktreeAdd`, `worktreeRemove`, `worktreeList`, `pruneStaleBranches` im Service
- `mergeBranch` im Service (story → proj, fix → story)
- Worktree-Erstellung vor TestPreparation
- `workspaceRoot` im `AdapterRuntimeContext` zeigt noch auf Repo-Root
- Merge Gate nach Story Review Pass
- Cleanup nach Merge (worktree remove + branch delete)
- `.beerengineer/worktrees/` in `.gitignore` des User-Workspace

## 3. Git-Struktur im User-Workspace

```
{workspaceRoot}/                         # User-Projekt-Repo
├── .git/
│   └── worktrees/                       # git-intern registrierte Worktrees
├── .beerengineer/                       # gitignored
│   └── worktrees/
│       ├── {storyCode}/                 # Story-Worktree (checkout von story/{p}/{s})
│       └── {storyCode}-fix-{n}/        # Remediation-Worktree (checkout von fix/{s}/{n})
├── src/
└── ...
```

Branches:
```
main
└─ proj/{code}
   ├─ story/{project}/{story-A}
   │  └─ fix/{story-A}/{reviewRunId}
   └─ story/{project}/{story-B}    # parallel
```

## 4. Phasenmodell: Was passiert wo

### Planning (Brainstorm → Spec → Architektur → Impl-Plan)

Keine git-Operationen.
Agents laufen im Haupt-Workspace ohne Code-Aenderungen.

### Planning Review

Keine git-Operationen.
Liest nur DB-Artefakte, kein Code, kein Worktree.

### Projekt-Execution Start

```bash
git branch proj/{code} main   # einmalig beim ersten Wave-Start
```

### Test Preparation (pro Story)

Engine:
```bash
git branch story/{p}/{s} proj/{p}
git worktree add {workspaceRoot}/.beerengineer/worktrees/{s} story/{p}/{s}
```

Agent laeuft mit:
```
workspaceRoot = {workspaceRoot}/.beerengineer/worktrees/{s}
```

Agent schreibt Failing-Tests und commitet:
```
test({storyCode}): prepare failing tests
```

Engine prueft: `headAfter !== headBefore`. Kein Commit → Execution-Fehler.
Worktree bleibt offen fuer Execution.

### Story Execution

Gleicher Worktree wie Test Prep.
Agent implementiert, commitet:
```
feat({storyCode}): implement story
```

Mehrere Commits erlaubt. Engine merged nicht nach Execution, sondern erst nach Review.

### Ralph Verification

```bash
cd {workspaceRoot}/.beerengineer/worktrees/{s}
npm test -- {testFiles}
```

Kein git. Laeuft im Worktree.
Bei Fail: Execution nochmals im selben Worktree. Story-Branch bleibt.

### App Verification

Startet App aus dem Worktree. Browser-Verification.
Kein git. Worktree bleibt offen.

### Implementation Review / Story Review

Kein Worktree, read-only.
Review-Agent liest Diff im Haupt-Workspace:
```bash
git diff proj/{p}..story/{p}/{s}
```

Review ist reine Lese-Operation. Kein Commit, kein Worktree.

### Story Accepted (Review passed)

Engine merge't **nicht** via Checkout im Haupt-Workspace, da dieser parallel dirty
sein kann. Stattdessen verwendet `GitWorkflowService` einen temporären
Merge-Worktree:
```bash
git worktree add --detach {workspaceRoot}/.beerengineer/worktrees/_merge/{s} proj/{p}
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/{s} checkout proj/{p}
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/{s} merge --no-ff story/{p}/{s}
git worktree remove {workspaceRoot}/.beerengineer/worktrees/_merge/{s} --force
git worktree remove {workspaceRoot}/.beerengineer/worktrees/{s} --force
git branch -d story/{p}/{s}
```

`GitBranchMetadata`:
- `mergedIntoRef = proj/{p}`
- `mergedCommitSha` = resulting merge commit sha

### Story Review Failed → Remediation

Engine:
```bash
git branch fix/{s}/{reviewRunId} story/{p}/{s}
git worktree add {workspaceRoot}/.beerengineer/worktrees/{s}-fix-{n} fix/{s}/{reviewRunId}
```

Remediation-Agent laeuft im neuen Worktree, commitet:
```
fix({storyCode}): address story review findings
```

Danach: Ralph Verification + Story Review nochmals (read-only, Diff `story/{p}/{s}..fix/{s}/{reviewRunId}`).

### Remediation Accepted

Engine:
```bash
# Fix → Story via temp merge-worktree
git worktree add --detach {workspaceRoot}/.beerengineer/worktrees/_merge/{s}-fix story/{p}/{s}
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/{s}-fix checkout story/{p}/{s}
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/{s}-fix merge --no-ff fix/{s}/{reviewRunId}
git worktree remove {workspaceRoot}/.beerengineer/worktrees/_merge/{s}-fix --force
git worktree remove {workspaceRoot}/.beerengineer/worktrees/{s}-fix-{n} --force
git branch -d fix/{s}/{reviewRunId}

# Story → Proj (gleich wie Story Accepted)
git worktree add --detach {workspaceRoot}/.beerengineer/worktrees/_merge/{s} proj/{p}
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/{s} checkout proj/{p}
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/{s} merge --no-ff story/{p}/{s}
git worktree remove {workspaceRoot}/.beerengineer/worktrees/_merge/{s} --force
git worktree remove {workspaceRoot}/.beerengineer/worktrees/{s} --force
git branch -d story/{p}/{s}
```

### Wave Complete

Keine expliziten git-Operationen.
`proj/{p}` enthaelt alle Stories der Wave.
Naechste Wave startet neue Stories von `proj/{p}`.

### Project Complete

Engine:
```bash
git worktree add --detach {workspaceRoot}/.beerengineer/worktrees/_merge/project-{code} main
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/project-{code} checkout main
git -C {workspaceRoot}/.beerengineer/worktrees/_merge/project-{code} merge --no-ff proj/{code}
git worktree remove {workspaceRoot}/.beerengineer/worktrees/_merge/project-{code} --force
git branch -d proj/{code}
```

## 5. Datemodell-Aenderungen

### GitBranchMetadata (src/domain/types.ts)

Neu:
```typescript
worktreePath: string | null;   // absoluter Pfad zum Worktree, null wenn simulated
```

### Persistenzstrategie

`gitMetadataJson` ist bereits die kanonische Persistenz fuer Git-Laufzeitdaten.
Deshalb:
- `worktreePath` wird **zuerst** in `GitBranchMetadata` und `gitMetadataJson` eingefuehrt
- `WaveStoryExecution.gitBranchName/gitBaseRef` und
  `StoryReviewRemediationRun.gitBranchName/gitBaseRef` bleiben als Denormalisierung bestehen
- eine zusaetzliche physische Spalte `git_worktree_path` ist optional und kein Blocker fuer
  die erste Umsetzung

Falls spaeter Reporting/Queries auf `worktreePath` noetig werden, kann eine
Folgemigration die Spalte ergaenzen.

## 6. GitWorkflowService Erweiterungen

### Neue Methoden

```typescript
// Worktree erstellen und Branch auschecken
public worktreeAdd(worktreePath: string, branchName: string): void

// Worktree entfernen (--force fuer den Fall dass noch uncommitted changes)
public worktreeRemove(worktreePath: string): void

// Alle registrierten Worktrees des Repos auflisten
public worktreeList(): string[]

// Verwaiste Worktree-Eintraege bereinigen
public pruneWorktrees(): void

// Branch in Ziel-Branch mergen (--no-ff) ohne Haupt-Workspace-Checkout
// Nutzt dafuer einen temporaeren Merge-Worktree unter .beerengineer/worktrees/_merge/
// Gibt merge-commit SHA zurueck
public mergeBranch(sourceBranch: string, targetBranch: string, mergeKey: string): string

// Branch loeschen (nur wenn vollstaendig gemergt)
public deleteBranch(branchName: string): void
```

### Anpassung ensureBranch

`ensureBranch` gibt kuenftig kein `worktreePath` zurueck — das ist Aufgabe der
aufrufenden Schicht. `worktreeAdd` wird separat aufgerufen nach `ensureBranch`.

### Dirty-Check Anpassung

Heute: Dirty Workspace → `strategy: "simulated"`, kein Branch.

Neu:
- Dirty-Check bleibt fuer `ensureProjectBranch` erhalten
- `ensureStoryBranch` und `ensureStoryRemediationBranch` duerfen trotz dirty
  Haupt-Workspace laufen, da der Agent in einem separaten Worktree arbeitet
- Merge-Operationen duerfen **nicht** vom Dirty-Zustand des Haupt-Workspace
  abhaengen, da sie in einem temporaeren Merge-Worktree stattfinden

## 7. Execution-Service Aenderungen

### src/workflow/execution-service.ts

`advanceExecution`:
- Vor `ensureProjectBranch`: keine Aenderung
- Vor `ensureStoryBranch`: nach wie vor branch erstellen
- **Neu nach `ensureStoryBranch`**: `worktreeAdd` aufrufen, Pfad in `GitBranchMetadata` schreiben

`buildAdapterRuntimeContext` / `buildStoryExecutionAdapterInput`:
- `BuildAdapterRuntimeContext` bekommt einen optionalen Override
  `workspaceRoot?: string`
- `runtime.workspaceRoot` neu = `gitMetadata.worktreePath ?? workspaceRoot`
- Gilt fuer TestPreparation, Execution, Ralph, AppVerification
- Review-Adapter bekommt weiterhin den Haupt-`workspaceRoot`

### src/workflow/verification-service.ts

- Ralph Verification: `workspaceRoot` → Worktree-Pfad (ueber GitMetadata aus DB)
- App Verification: gleich
- Story Review / Implementation Review: Haupt-`workspaceRoot` (read-only, kein Worktree)
- Remediation: `ensureStoryRemediationBranch` → danach `worktreeAdd` → neuer Worktree-Pfad

### Merge Gate nach Story-Completion

Neuer Orchestrierungsschritt auf `WorkflowService`-/`VerificationService`-Ebene
nach bestandenem Story Review:
1. Pruefe ob Story Review bestanden
2. `mergeBranch(story/{p}/{s}, proj/{p}, {storyCode})`
3. `worktreeRemove(worktreePath)`
4. `deleteBranch(story/{p}/{s})`
5. `GitBranchMetadata.mergedIntoRef` und `mergedCommitSha` schreiben

Merge nur wenn:
- Basic Verification: passed
- Ralph: passed
- App Verification: passed (falls ausgefuehrt)
- Story Review: passed

### Merge Gate nach Remediation

In `startStoryReviewRemediation` nach Remediation-Completion:
1. `mergeBranch(fix/{s}/{n}, story/{p}/{s}, {storyCode}-fix-{attempt})`
2. `worktreeRemove(fixWorktreePath)`
3. `deleteBranch(fix/{s}/{n})`
4. Danach: `mergeBranch(story/{p}/{s}, proj/{p}, {storyCode})` + story-worktree cleanup

## 8. .gitignore Automatik

### src/services/workspace-setup-service.ts

Beim `workspace:setup` (Greenfield und Brownfield):
- Pruefe ob `.beerengineer/worktrees/` in `.gitignore` des User-Workspace eingetragen ist
- Wenn nicht: Eintrag automatisch hinzufuegen

Eintrag:
```
# beerengineer worktrees (managed by beerengineer CLI)
.beerengineer/worktrees/
```

## 9. Cleanup-Mechanismus

### Verwaiste Worktrees

Faelle wo Worktrees nicht sauber bereinigt wurden:
- Story permanent failed (Retry-Limit erreicht)
- Remediation-Limit erreicht
- Prozess-Absturz waehrend Worktree-Lifecycle

### Pruning beim Start

`workflow-service.ts`: Beim Start von `advanceExecution`:
- `pruneWorktrees()` aufrufen
- bereinigt stale git-Registrierungen immer
- entfernt Dateisystem-Worktrees nur dann automatisch, wenn die zugehoerige
  Execution/Remediation bereits abgeschlossen ist

### CLI-Command workspace:prune

Neuer Command `workspace:prune --project {code}`:
- Listet alle Worktrees im `{workspaceRoot}/.beerengineer/worktrees/`
- Prueft fuer jeden: ist der Branch gemergt? Ist die Execution abgeschlossen?
- Entfernt sichere Worktrees + Branches
- Gibt Warnung fuer unsichere (noch laufende Executions)

## 10. Rollen-Uebersicht

| Agent / Service          | Worktree? | Schreibt Code? | Branch               |
|--------------------------|-----------|----------------|----------------------|
| Planning Review          | Nein      | Nein           | —                    |
| Implementation Review    | Nein      | Nein           | liest story-Diff     |
| Story Review             | Nein      | Nein           | liest story-Diff     |
| Test Preparation         | Ja        | Ja (commit)    | `story/{p}/{s}`      |
| Execution                | Ja        | Ja (commit)    | `story/{p}/{s}`      |
| Ralph Verification       | Ja        | Nein           | `story/{p}/{s}`      |
| App Verification         | Ja        | Nein           | `story/{p}/{s}`      |
| Remediation              | Ja (fix)  | Ja (commit)    | `fix/{s}/{n}`        |
| **Engine**               | erstellt/entfernt | Ja (merge, branch) | koordiniert  |

## 11. Verhalten bei Fehlern

| Situation                          | Verhalten                                         |
|------------------------------------|---------------------------------------------------|
| Agent commitet nicht               | Execution-Fehler, Worktree bleibt zur Inspektion  |
| Verification failed                | Worktree bleibt, Retry im selben Worktree         |
| Story permanent failed             | Worktree + Branch bleiben, `workspace:prune` noetig |
| Remediation-Limit erreicht         | Fix-Worktree + Branch bleiben                     |
| Merge-Konflikt                     | Engine rebasiert Story-Branch auf aktuellen Proj-Branch, Execution-Retry |
| Worktree-Path nicht mehr vorhanden | `pruneWorktrees()` bereinigt git-internen Eintrag |

## 12. Umsetzungsreihenfolge

### Phase 1: Service-Grundlage

1. `GitWorkflowService` um `worktreeAdd`, `worktreeRemove`, `worktreeList`, `pruneWorktrees`, `mergeBranch`, `deleteBranch` erweitern
2. `GitBranchMetadata` um `worktreePath: string | null` erweitern
3. JSON-basierte Persistenz ueber `gitMetadataJson` sicherstellen; optionale DB-Spalte ist nachrangig

### Phase 2: TestPrep und Execution im Worktree

4. `advanceExecution`: nach `ensureStoryBranch` → `worktreeAdd` → Pfad in Metadata
5. `buildAdapterRuntimeContext`: `workspaceRoot` = Worktree-Pfad fuer ausfuehrende Agents
6. Review-Adapter behaelt Haupt-`workspaceRoot`
7. `hasUncommittedChanges` im Story-/Fix-Branch-Kontext: nur Warnung, kein Block

### Phase 3: Merge Gate

8. Nach Story Review Pass: `mergeBranch` story → proj, Worktree cleanup
9. `GitBranchMetadata.mergedIntoRef` und `mergedCommitSha` persistieren

### Phase 4: Remediation Worktree

10. `startStoryReviewRemediation`: `worktreeAdd` fuer Fix-Branch
11. Nach Remediation: `mergeBranch` fix → story, Fix-Worktree cleanup
12. Anschliessend story → proj Merge (aus Phase 3 wiederverwenden)

### Phase 5: Infrastruktur

13. `.gitignore`-Automatik im `workspace:setup`
14. `workspace:prune` CLI-Command
15. `pruneWorktrees()` beim Start von `advanceExecution`
16. `documentation-service.ts` / weitere Leser von `gitMetadataJson` auf
    `worktreePath` statt altes `workspaceRoot` ausrichten
17. Project-Complete: proj → main Merge + proj-Branch-Cleanup

### Phase 6: Tests und Dokumentation

18. Unit-Tests fuer `GitWorkflowService` neue Methoden
19. Integration-Test: vollstaendiger Story-Lifecycle mit Worktree
20. Dokumentation im `docs/reference/` nachziehen

## 13. Nicht-Ziele dieses Plans

- GitHub PR Automation (kein `gh pr create`)
- Release-Tagging
- Cross-Repo-Orchestration
- Deployment-Automation
- QA-Remediation Worktree (folgt in separatem Plan)
- Squash-Merge-Option (merge commits als Default)

## 14. Erfolgskriterien

Der Plan ist umgesetzt wenn:

- Jede Story-Execution in einem dedizierten Worktree laeuft
- Parallele Stories sich nie gegenseitig behindern (je eigener Worktree)
- `workspaceRoot` im Adapter-Request immer auf den aktiven Worktree zeigt
- Agents haben keine Kenntnisse von Branch-Namen (nur Filesystem-Pfad)
- Die Engine merged sauber nach Review-Pass
- Worktrees werden nach Merge entfernt
- Remediation bekommt eigenen Worktree auf Fix-Branch
- `mergedCommitSha` wird in der DB persistiert
- `workspace:prune` bereinigt verwaiste Worktrees zuverlaessig
- `.beerengineer/worktrees/` ist im `.gitignore` des User-Workspace
- Die bestehende `strategy: "simulated"` Logik bleibt als Fallback erhalten
