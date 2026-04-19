# App Verification Specification

## Ziel

BeerEngineer soll nach einer Story-Implementation die App selbst im Browser
pruefen koennen.

Der Step soll sicherstellen:

- die umgesetzte Story ist im echten Produktfluss erreichbar
- zentrale Acceptance Criteria funktionieren in der laufenden App
- UI- oder Integrationsfehler werden vor dem spaeteren Projekt-QA-Gate erkannt

Der primäre Runner ist `agent_browser`.
Falls dieser nicht verfuegbar oder fuer den konkreten Lauf nicht nutzbar ist,
soll auf `playwright` zurueckgefallen werden koennen.

## Position im Workflow

`app_verification` ist ein eigener Runtime-Step zwischen `execution` und dem
spaeteren Projekt-`qa`.

Empfohlener Story-Lauf:

1. `execution`
2. `app_verification`
3. `story_review`
4. optional `story_review_remediation`
5. naechste Story oder naechste Wave

Projektweit danach:

1. `qa`
2. `documentation`

`app_verification` ist damit kein Teil von `qa`.

Gruende:

- der Schritt prueft die gerade gelieferte Story, nicht das ganze Projekt
- Fehler sind frueher und praeziser einer Story zuordenbar
- Retry- und Remediation-Pfade bleiben story-spezifisch
- das spaetere `qa` bleibt ein projektweiter Gate- und Integrationsschritt

## Scope des Steps

`app_verification` prueft story-spezifische Produktfluesse:

- Einstieg in die relevante Route oder UI-Flaeche
- Login mit der benoetigten Rolle
- Interaktion mit den betroffenen Controls
- Sichtbarkeit und Verhalten gemaess Acceptance Criteria
- einfache Persistenz- oder Success-Signale in der App

Nicht primaerer Scope:

- breite Projekt-Regression
- exploratives Gesamt-QA
- tiefes Code- oder Architekturreview
- reine API- oder Unit-Checks ohne sichtbaren Produktfluss

Wenn ein Browser-Test nicht story-spezifisch ist, sondern ein globaler
Smoke-/Regressionstest, gehoert er spaeter eher in `qa`.

## Kontextmodell

`app_verification` darf den App-Kontext nicht frei erraten.
Der Step braucht vorbereiteten, reproduzierbaren Kontext.

Es gibt dafuer drei Ebenen.

### 1. Project App Test Context

Geteilter App-Test-Kontext fuer ein gesamtes Project oder einen gesamten Run.

Beispielinhalt:

- `baseUrl`
- App-Start- oder Attach-Strategie
- Readiness- oder Health-Checks
- Auth-Strategie
- verfuegbare Test-User und Rollen
- Fixture- oder Seed-Strategie
- relevante Feature Flags
- bekannte Mandanten-, Workspace- oder Tenant-Defaults
- bevorzugte Runner-Reihenfolge

Beispielstruktur:

```ts
type ProjectAppTestContext = {
  projectId: string;
  workspaceRoot: string;
  baseUrl: string;
  runnerPreference: Array<"agent_browser" | "playwright">;
  readiness?: {
    healthUrl?: string;
    command?: string;
    timeoutMs?: number;
  };
  auth: {
    strategy: "password" | "magic_link" | "oauth_stub" | "existing_session";
    defaultRole?: string;
  };
  users: Array<{
    key: string;
    role: string;
    email?: string;
    passwordSecretRef?: string;
  }>;
  fixtures?: {
    seedCommand?: string;
    resetCommand?: string;
  };
  featureFlags?: Record<string, boolean | string>;
};
```

### 2. Story App Verification Context

Story-spezifischer Pruefauftrag auf Basis von:

- Story
- Acceptance Criteria
- Planungsartefakten
- Execution-Ergebnis
- bekannten betroffenen Pfaden oder Screens

Beispielinhalt:

- Ziel der Story
- zu pruefende UI-Flows
- benoetigte Rolle
- relevante Start-Route
- Vorbedingungen
- erwartetes Verhalten
- wichtige Negative Checks

Beispielstruktur:

```ts
type StoryAppVerificationContext = {
  waveStoryExecutionId: string;
  storyId: string;
  storyTitle: string;
  summary: string;
  acceptanceCriteria: string[];
  preferredRole?: string;
  startRoute?: string;
  changedFiles: string[];
  checks: Array<{
    id: string;
    description: string;
    expectedOutcome: string;
  }>;
  preconditions?: string[];
  notes?: string[];
};
```

### 3. Prepared Session Context

Laufzeit-Ergebnis eines Prepare-Schritts vor dem eigentlichen Browser-Run.

Beispielinhalt:

- gewaehltet Runner
- gestartete oder verifizierte App-Session
- erfolgreich eingeloggter User
- vorbereitete Testdaten
- finale Start-URL

Beispielstruktur:

```ts
type PreparedSessionContext = {
  runner: "agent_browser" | "playwright";
  baseUrl: string;
  ready: boolean;
  loginRole?: string;
  loginUserKey?: string;
  resolvedStartUrl?: string;
  seeded: boolean;
  artifactsDir?: string;
};
```

## Interner Ablauf

`app_verification` ist ein kleiner Sub-Workflow.

### 1. Build Context

Die Engine erzeugt:

- `ProjectAppTestContext`
- `StoryAppVerificationContext`

Dieser Schritt soll deklarative Konfiguration priorisieren.
Login, URLs und User-Rollen sollen nicht dem freien Agent-Prompt ueberlassen
werden.

### 2. Prepare Session

Vor der eigentlichen Story-Pruefung:

- App erreichbar?
- Healthcheck erfolgreich?
- benoetigter User verfuergbar?
- Login moeglich?
- benoetigte Fixtures gesetzt?
- relevante Start-Route aufrufbar?

Wenn dieser Schritt scheitert, ist das primaer ein Infrastruktur- oder
Konfigurationsproblem, nicht automatisch ein Produktfehler.

### 3. Execute Verification

Dann wird der eigentliche Story-Flow geprueft:

- relevante Route oeffnen
- wesentliche Interaktionen ausfuehren
- erwartete UI-Signale und Outcomes pruefen
- Screenshots, Logs und ggf. Traces sammeln

### 4. Evaluate Result

Die Engine klassifiziert das Ergebnis in einen Run-Status und ggf. Findings.

## Runner-Strategie

Die bevorzugte Runner-Folge ist:

1. `agent_browser`
2. `playwright`

Fallback auf `playwright` nur, wenn:

- `agent_browser` technisch nicht verfuegbar ist
- der Agent-Runner fuer den Lauf nicht korrekt initialisiert werden kann
- eine klar als Infrastrukturproblem klassifizierte Runner-Initialisierung
  scheitert

Kein Fallback bei produktbezogenem Fehler:

- Login-Button fehlt
- Formular bricht fachlich
- erwartete UI nicht vorhanden
- Navigation oder Persistenz ist falsch

In solchen Faellen soll das Ergebnis als Produkt- oder Review-Problem erhalten
bleiben.

## Datenmodell

Es braucht eine eigene Runtime fuer Story-basierte App-Pruefung.

### AppVerificationRun

Vorschlag:

```ts
type AppVerificationRunStatus =
  | "pending"
  | "preparing"
  | "in_progress"
  | "passed"
  | "review_required"
  | "failed";

type AppVerificationRun = {
  id: string;
  waveStoryExecutionId: string;
  status: AppVerificationRunStatus;
  runner: "agent_browser" | "playwright";
  attemptCount: number;
  startedAt?: string;
  completedAt?: string;
  projectAppTestContextJson?: string;
  storyContextJson?: string;
  preparedSessionJson?: string;
  resultJson?: string;
  artifactsJson?: string;
  failureSummary?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Optionale Findings

Falls strukturierte Browser-Findings gebraucht werden:

```ts
type AppVerificationFindingSeverity = "low" | "medium" | "high";

type AppVerificationFinding = {
  id: string;
  appVerificationRunId: string;
  severity: AppVerificationFindingSeverity;
  title: string;
  summary: string;
  route?: string;
  selectorHint?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  isAutoFixable: boolean;
  fingerprint: string;
  createdAt: string;
};
```

Im ersten Slice kann auch `resultJson` alleine reichen.
Eine separate Findings-Tabelle lohnt sich, wenn spaeter App-Verification-
Remediation automatisch oder selektiv laufen soll.

## Status- und Fehlersemantik

### `passed`

Die Story ist im Browser erfolgreich verifiziert:

- Setup war erfolgreich
- benoetigter User konnte sich einloggen oder die App sauber erreichen
- relevante Acceptance-Flows funktionieren

### `review_required`

Es liegt ein reproduzierbarer Produkt- oder UI-Fehler vor.

Beispiele:

- relevante UI fehlt
- Workflow endet in falschem Zustand
- Formular validiert falsch
- erwarteter Success-State tritt nicht ein
- Story-Akzeptanz im Produktfluss ist verletzt

### `failed`

Es liegt ein Infrastruktur-, Runner- oder Umgebungsproblem vor.

Beispiele:

- Browser konnte nicht gestartet werden
- App ist nicht erreichbar
- Readiness-Pruefung scheitert
- Seed-/Fixture-Layer ist defekt
- Artefakt- oder Session-Setup bricht technisch

Wichtig:

- `review_required` ist fachlich oder produktseitig
- `failed` ist technisch oder infrastrukturell

Ohne diese Trennung versucht die Engine sonst Infrastrukturprobleme
faelschlich als Produktfehler zu beheben.

## Integration in den Story-Flow

Empfohlene Regel:

- `story_review` startet erst, wenn `app_verification` fuer die Story `passed`
  ist

Damit wird die Reihenfolge:

1. Code gebaut
2. Produktfluss im Browser bestaetigt
3. danach Review-/Finding-Ebene

Alternative spaeter:

- `story_review` und `app_verification` koennen parallel laufen

Das wuerde ich im ersten Slice nicht bauen.
Die serielle Reihenfolge ist einfacher, deterministischer und fuer Autorun
klarer.

## Autorun-Integration

Nach erfolgreicher Story-Execution soll Autorun wie folgt entscheiden:

1. Gibt es fuer die Story noch keine `app_verification`?
   Dann `app-verification:start`
2. Ist die letzte `app_verification` `passed`?
   Dann weiter zu `story_review` oder zum naechsten Story-/Wave-Schritt
3. Ist sie `review_required`?
   Dann:
   - stoppen
   - oder spaeter App-Verification-Remediation nach Policy
4. Ist sie `failed`?
   Dann stoppen oder retrybar behandeln

### Erster empfohlener Slice

Im ersten Slice:

- `app_verification` wird automatisch in Autorun gestartet
- `review_required` stoppt Autorun
- `failed` stoppt Autorun
- kein Auto-Remediation-Pfad fuer `app_verification`
- Retry nur explizit durch User

Das haelt das System einfach und nachvollziehbar.

## CLI-Vorschlag

Neue Kommandos:

- `app-verification:start --project-id <id>`
- `app-verification:show --app-verification-run-id <id>`
- `app-verification:retry --app-verification-run-id <id>`

Optional spaeter:

- `app-verification:list --project-id <id>`

Autorun-Hooks:

- `planning:approve --autorun`
- `execution:retry --autorun`
- spaeter `app-verification:retry --autorun`

## Konfiguration

Es braucht eine deklarative App-Test-Konfiguration auf Projekt- oder Workspace-
Ebene.

Vorschlag:

```ts
type AppTestConfig = {
  baseUrl?: string;
  runnerPreference?: Array<"agent_browser" | "playwright">;
  readiness?: {
    healthUrl?: string;
    command?: string;
    timeoutMs?: number;
  };
  auth?: {
    strategy: "password" | "magic_link" | "oauth_stub" | "existing_session";
    defaultRole?: string;
  };
  users?: Array<{
    key: string;
    role: string;
    email?: string;
    passwordSecretRef?: string;
  }>;
  fixtures?: {
    seedCommand?: string;
    resetCommand?: string;
  };
  routes?: Record<string, string>;
  featureFlags?: Record<string, boolean | string>;
};
```

Wichtig:

- Login und User-Rollen sollen konfiguriert, nicht improvisiert werden
- Secrets sollen nur als Referenzen erscheinen, nicht im Klartext
- der Browser-Step darf fehlende Basisdaten nicht frei halluzinieren

## UI-Sicht

Das UI soll `app_verification` als Story-Substatus anzeigen, aber nicht als
manuell verschiebbare Board-Column.

Beispielhafte interne Story-Substates:

- `execution`
- `app_verification`
- `story_review`
- `remediation`

Das Item bleibt fuer den User weiterhin in `implementation`, bis der gesamte
Delivery-Lauf erfolgreich abgeschlossen ist.

## Artefakte

`app_verification` soll standardisiert Artefakte sammeln:

- Screenshots
- Browser- oder Runner-Logs
- Trace-Dateien, falls verfuegbar
- finale Kurzbewertung
- ggf. strukturierte Findings

Diese Artefakte sollen:

- in `show`-Ausgaben referenzierbar sein
- fuer spaetere UI-Anzeige nutzbar sein
- bei Retry-Laeufen vergleichbar bleiben

## Retry-Policy

Empfehlung fuer den ersten Slice:

- expliziter Retry durch den User
- maximal begrenzte Retry-Anzahl
- keine automatische Endlosschleife

Retry ist nur sinnvoll, wenn:

- Setup oder Infrastrukturproblem behoben wurde
- Testdaten oder Login-Konfiguration korrigiert wurden
- Runner-Auswahl geaendert wurde

Bei stabil reproduzierbarem Produktfehler ist Retry ohne Code-Aenderung meist
nicht sinnvoll.

## Implementierungsreihenfolge

1. Datenmodell fuer `AppVerificationRun`
2. Repository und `show/start/retry`
3. Konfigurationsmodell fuer `AppTestConfig`
4. Context-Builder fuer Projekt und Story
5. Prepare-Phase fuer App-Readiness und Login
6. Runner-Adapter fuer `agent_browser` mit `playwright`-Fallback
7. Autorun-Integration nach `execution`
8. CLI-Kommandos
9. Artefakt-Speicherung und `show`-Output
10. spaeter optional Findings + Remediation

## Offene Entscheidungen

Vor der Implementierung sind diese Produktentscheidungen zu klaeren:

- Wo wird `AppTestConfig` gespeichert: global, pro Item oder pro Project?
- Muss die Engine die App selbst starten koennen oder nur an eine laufende App
  attachen?
- Welche Auth-Strategien werden im MVP offiziell unterstuetzt?
- Soll `story_review` strikt nach `app_verification` laufen oder spaeter
  parallelisierbar sein?
- Braucht `app_verification` im MVP bereits eigene Findings mit Auto-Fix-Flag?
- Sollen manche Story-Typen `app_verification` explizit skippen duerfen?

## Empfehlung

Fuer BeerEngineer wuerde ich den Step im ersten Slice so bauen:

- pro Story, nicht nur in `qa`
- mit vorbereitetem Projekt- und Story-Kontext
- mit expliziter Prepare-Phase
- mit Runner-Reihenfolge `agent_browser -> playwright`
- mit klarer Trennung zwischen `review_required` und `failed`
- ohne automatische App-Verification-Remediation im ersten Schritt

So bleibt der Flow robust, nachvollziehbar und spaeter sauber erweiterbar.
