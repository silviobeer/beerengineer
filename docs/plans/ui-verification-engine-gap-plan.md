# UI Verification Engine Gap Plan

## Ziel

BeerEngineer soll UI-Stories nicht erst nach erfolgreicher Implementation an
offensichtlichen Browser- oder Verifikationsluecken scheitern lassen.

Die Engine muss vor `execution` sauber erkennen:

- ob browserbasierte Story-Verifikation ueberhaupt lauffaehig ist
- ob `agent_browser`, `playwright` und der UI-Server-Contract verfuegbar sind
- ob ein fehlender Projekt-Setup-Schritt vorliegt oder ein echter Engine-Fehler

## Problemabgrenzung

Der aktuelle Fall zeigt zwei verschiedene Ursachen:

### 1. Projekt-Setup-Luecke

- `apps/ui` hatte keine eigene Playwright-Konfiguration
- es gab keinen definierten UI-Server-/`baseUrl`-Contract fuer Browser-Tests
- die UI-App hatte keinen expliziten E2E-Skriptpfad

### 2. Engine-Luecke

- `execution` durfte starten, obwohl die Story-Verifikation fuer eine UI-Story
  nicht vollstaendig vorbereitet war
- die Engine prueft bisher Build/Typecheck-Readiness, aber nicht die
  Verifikations-Readiness fuer `agent_browser`/`playwright`
- dadurch entsteht ein zu spaeter Fehlerpunkt nach erfolgreicher
  Codex-Implementation

## Bereits vorhandene Grundlage

BeerEngineer besitzt bereits einen zentralen App-Verification-Contract.

Die Source of Truth ist nicht eine projektspezifische Testdatei oder ein
lokaler Playwright-Port, sondern `WorkspaceSettings.appTestConfigJson`.

Dieser zentrale Contract wird bereits in `VerificationService` gelesen und
enthaelt insbesondere:

- `baseUrl`
- `runnerPreference`
- `readiness`
- `auth`
- `users`
- `fixtures`
- `routes`
- `featureFlags`

Der aktuelle Default in der Engine ist:

- pro Workspace eine dedizierte `baseUrl`, nicht `:3000`
- `runnerPreference = ["agent_browser", "playwright"]`

Zusatzregel:

- jeder Workspace bekommt eine eigene localhost-URL fuer Browser-Verifikation
- `:3000` gilt explizit nicht mehr als zulaessiger Default
- die Default-URL muss deterministisch aus dem Workspace-Kontext ableitbar sein,
  damit Playwright-/Server-Contract und Engine-Defaults konsistent bleiben

Wichtig:

- das neue Engine-Gate darf keinen zweiten konkurrierenden Port-/URL-Mechanismus
  einfuehren
- projektlokale Browser-Runner-Konfiguration muss mit dem zentralen Contract
  kompatibel sein oder daraus ableitbar werden
- `agent_browser -> playwright` ist bereits eine bestehende Engine-Regel, keine
  neue Produktentscheidung

## Zielbild

Vor jeder UI-Story-Execution gibt es zwei klar getrennte Gates:

1. `execution_readiness`
2. `verification_readiness`

`verification_readiness` prueft mindestens:

- ob `WorkspaceSettings.appTestConfigJson` vorhanden, parsebar und fuer die
  Story ausreichend ist
- `baseUrl` oder ableitbare Start-URL
- UI-Server-Start-Contract
- `agent-browser`-Verfuegbarkeit
- `playwright`-Verfuegbarkeit
- Playwright-Konfiguration und Testpfade
- benoetigte Browser-/Harness-Artefakte
- story-spezifische Verifikationsstrategie

Wenn diese Schicht nicht gruen ist, darf `execution` fuer betroffene UI-Stories
nicht starten.

## Scope

In Scope:

- neues Engine-Gate fuer UI-Verifikationsbereitschaft
- Klassifikation in Projekt-Setup vs Engine-/Infrastrukturproblem
- explizite Beruecksichtigung von `agent_browser` und `playwright`
- Persistenz und CLI-Sichtbarkeit fuer den neuen Gate-Zustand
- Autorun-/Execution-Stop vor Story-Implementation bei fehlender Readiness

Nicht in Scope:

- allgemeine Browser-Automatisierungs-Features ausserhalb des Story-Flows
- komplette agent-browser-Produktstrategie
- beliebige projektindividuelle Testorchestrierung ohne klares Contract-Modell

## Fachliche Regeln

### UI-Story-Erkennung

Die Engine behandelt eine Story als UI-verifikationspflichtig, wenn mindestens
eine der folgenden Bedingungen zutrifft:

- Worker-Rolle ist `frontend-implementer`
- Story-/AC-Text enthaelt UI-/Screen-/Route-/Component-Signale
- Projektprofil oder Workspace-App-Test-Kontext markiert Browser-Verifikation
  als erforderlich

### Runner-Reihenfolge

Die Runner-Reihenfolge bleibt:

1. `agent_browser`
2. `playwright`

Aber:

- `playwright` ist nur Fallback auf Runner-Ebene
- fehlender Projekt-Setup darf nicht als Produktfehler maskiert werden
- fehlende Runner-/Server-/Config-Bereitschaft blockiert vor `execution`
- die Reihenfolge wird aus dem zentralen App-Test-Contract uebernommen, nicht
  von projektlokalen Defaults neu definiert

### Source of Truth

Fuer URL, Runner-Prioritaet und Story-Route gilt:

- primaere Quelle: `WorkspaceSettings.appTestConfigJson`
- sekundaere Quelle: davon ableitbare Runtime-Daten wie `resolvedStartUrl`
- projektspezifische Dateien wie `playwright.config.*` sind Implementierungs-
  und Ausfuehrungsdetails, nicht die fachliche Wahrheit

Das neue Gate muss deshalb zuerst den zentralen Contract validieren und erst
danach pruefen, ob das Projekt-Setup diesen Contract tatsaechlich ausfuehren
kann.

### Status-Semantik

- `ready`: Story darf in `execution`
- `auto_fixable`: sichere Setup-Schritte sind moeglich
- `blocked`: manueller Setup- oder Konfigurationsbedarf
- `failed`: Gate selbst konnte technisch nicht korrekt ausgefuehrt werden

## Engine-Aenderungen

### 1. Verification Readiness Service

Neuer Core-/Service-Layer analog zu `ExecutionReadinessService`.

Verantwortung:

- Validieren des zentralen App-Test-Contracts aus
  `WorkspaceSettings.appTestConfigJson`
- Ermitteln des UI-Verifikationsprofils
- Pruefen des Browser- und Server-Contracts
- Klassifizieren in `ready` / `auto_fixable` / `blocked` / `failed`
- strukturierte Findings und empfohlene Aktionen liefern

### 2. Profile

Erster Ziel-Adapter:

- `node-next-browser-verification`

Checks:

- zentraler App-Test-Contract ist vorhanden oder es greift bewusst der
  bekannte Engine-Default
- `baseUrl` aus dem zentralen Contract ist konsistent
- `baseUrl` ist eine dedizierte Workspace-URL und nicht `:3000`
- story-spezifische Route ist aus `routes` oder Default-Route ableitbar
- `apps/ui/package.json` vorhanden
- `apps/ui/playwright.config.*` vorhanden
- `@playwright/test` installiert
- Playwright CLI aufloesbar
- `agent-browser` auf PATH oder via Harness erreichbar
- `baseUrl` ist nicht nur gesetzt, sondern durch das Projekt-Setup nutzbar
- `webServer.command` oder gleichwertiger Start-Contract vorhanden
- verifizierbarer Testpfad vorhanden

Zusatzklassifikation:

- zentraler Contract fehlt oder ist invalide
  - Engine-/Workspace-Konfigurationsproblem
- zentraler Contract ist valide, aber Projekt-Setup kann ihn nicht ausfuehren
  - Projekt-Setup-Problem

### 3. Auto-Remediation

Nur allowlist-basiert:

- `npm --prefix apps/ui install`
- optional `npx playwright install`
- optionale Materialisierung fehlender Harness-MCP-Eintraege nur ueber bereits
  bestehende Workspace-Befehle

Nicht auto-fixbar:

- unklare oder widerspruechliche `baseUrl`
- `baseUrl` auf shared `:3000`
- fehlende Story-/Projekt-Routen
- kaputte Testarchitektur
- fehlende Secrets oder externe Dienste

### 4. Execution-Gating

Vor `ensureWaveStoryTestPreparation` bzw. spaetestens vor `executeWaveStory`:

- `execution_readiness`
- fuer UI-Stories zusaetzlich `verification_readiness`

Wenn `verification_readiness` nicht `ready` ist:

- kein Test Preparation Run
- kein Implementation Run
- strukturierter Stop mit Reason wie
  `story_verification_readiness_failed`

Dabei muss der Stopgrund explizit unterscheiden koennen:

- zentraler App-Test-Contract fehlt oder ist ungueltig
- Projekt-Setup kann den vorhandenen Contract nicht ausfuehren

### 5. Resume-/Retry-Pfad

`execution:retry` muss dieselben Gates erneut anwenden.

## Persistenz

Neue Records analog zur bestehenden Readiness-Schicht:

- `verification_readiness_runs`
- `verification_readiness_findings`
- `verification_readiness_actions`

Persistiert werden:

- Profil
- Workspace-/Worktree-Pfad
- betroffene Story
- Check-Ergebnisse
- geplante/ausgefuehrte Auto-Fixes
- finaler Gate-Status

## CLI

Neue Kommandos:

- `verification:readiness:start --project-id <id> [--story-code <code>]`
- `verification:readiness:show --project-id <id>`
- `verification:readiness:show --run-id <id>`

`execution:show` soll den letzten Verification-Readiness-Status kompakt
sichtbar machen, wenn er den Story-Start blockiert.

## Doctor-Integration

`workspace:doctor` braucht zusaetzliche Gruppen fuer Browser-Verifikation:

- `browserVerification`
- `agentBrowser`
- `playwrightSetup`
- `uiServerContract`

Beispiele:

- zentraler App-Test-Contract fehlt oder ist invalide
- Playwright-Config fehlt
- `agent-browser` nicht verfuegbar
- `baseUrl` nicht konfiguriert oder auf shared `:3000`
- kein `webServer`-Contract fuer UI-Tests

## Autorun-Verhalten

Bei UI-Stories:

1. `execution_readiness`
2. `verification_readiness`
3. erst dann `test_preparation`
4. erst dann `execution`

Wenn `verification_readiness` blockiert:

- Autorun stoppt sauber
- kein spaeter Scheinfehler in `app_verification`
- klare Handlungsempfehlung fuer Projekt-Setup oder manuelle Konfiguration

## Tests

Erforderlich:

- UI-Story wird vor `execution` blockiert, wenn Playwright-Config fehlt
- UI-Story wird vor `execution` blockiert, wenn `baseUrl`/Server-Contract fehlt
- UI-Story wird vor `execution` blockiert, wenn `baseUrl` auf shared
  `localhost:3000` zeigt
- UI-Story wird vor `execution` blockiert, wenn `WorkspaceSettings.appTestConfigJson`
  ungueltig oder fuer die Story unvollstaendig ist
- Fallback-Reihenfolge `agent_browser -> playwright` bleibt erhalten
- auto-fixbare Playwright-Install-Luecke wird sauber remediated
- nicht-auto-fixbare Verifikationsluecke bleibt `blocked`

## Umsetzung in Phasen

### Phase 1

- Service/Domain/Persistenz fuer `verification_readiness`
- CLI und `workspace:doctor`
- Validierung des zentralen `appTestConfigJson`-Contracts
- erste Tests fuer blockierende Faelle

### Phase 2

- Gate in `execution:start` und `execution:retry`
- kompakte Anzeige in `execution:show`
- Autorun-Stopreason fuer Verification-Readiness

### Phase 3

- deterministische Auto-Remediation
- feinere `agent_browser`-/Harness-Pruefungen
- bessere Differenzierung von Setup- gegen Infrastrukturfehler

## Erfolgsbedingung

Ein UI-Projekt mit unvollstaendigem Browser-Setup darf kuenftig nicht mehr so
scheitern:

- Codex implementiert erfolgreich
- erst danach faellt der Story-Run an fehlender Browser-Verifikation um

Stattdessen muss die Engine frueh und strukturiert sagen:

- welches Setup fehlt
- ob BeerEngineer es selbst reparieren kann
- oder warum der User/Workspace zuerst nachziehen muss
