# Workspace Runtime Profiles Implementation Plan

## 1. Ziel

BeerEngineer soll pro Workspace sauber steuern koennen,

- welcher Harness standardmaessig fuer welchen Schritt eingesetzt wird
- welches Modell pro Schritt genutzt wird
- welche sofort nutzbaren Presets fuer "Codex als Haupt-Abo" und "Claude als Haupt-Abo" verfuegbar sind
- wie die effektive Runtime fuer einen konkreten Lauf deterministisch aufgeloest wird

Das Feature soll so gebaut werden, dass mehrere Workspaces im selben Repo unterschiedliche Agent-Strategien fahren koennen, ohne globale Runtime-Dateien oder Shell-Commands pro Workspace zu verbiegen.

## 1.1 Namenskonvention

Wir verwenden zwei bewusst getrennte Konventionen:

- interner `profileKey` in CLI, DB und JSON-Inhalt:
  - `codex_primary`
  - `claude_primary`
- Dateiname fuer Built-in-Profil-Dateien:
  - `codex-primary.json`
  - `claude-primary.json`

Die Abbildung ist explizit und nicht implizit:

- `codex_primary` -> `config/runtime-profiles/codex-primary.json`
- `claude_primary` -> `config/runtime-profiles/claude-primary.json`

Der Loader darf sich nicht auf freie String-Normalisierung verlassen, sondern soll nur bekannte Built-in-Keys auf bekannte Dateien mappen.

## 2. Problemdefinition

Heute existiert bereits eine globale Runtime-Konfiguration in:

- `config/agent-runtime.json`
- optional `userDataDir/config/agent-runtime.override.json`

Das reicht aber nicht aus fuer:

- einen Workspace, der Codex teuer und gezielt fuer code-lastige Schritte einsetzt
- einen anderen Workspace, der Claude als primaeren Agent nutzt
- eine sichtbare und debugbare Aufloesung pro Stage, Interactive-Flow und Worker
- einen Setup-/Assist-Pfad, der den Nutzer am Anfang nach einer sinnvollen Strategie fragt

## 3. Leitprinzipien

### 3.1 Basis bleibt global

Die globale Runtime bleibt die Produkt-Basis:

- Installations-Default im Repo
- optionaler globaler User-Override im `userDataDir`

Workspace-Profile legen sich nur darueber.

### 3.2 Workspace-Profile aendern nur Selektion

Workspace-Profile duerfen nur diese Dinge beeinflussen:

- `defaultProvider`
- `defaults.interactive`
- `defaults.autonomous`
- `interactive.*`
- `stages.*`
- `workers.*`

Workspace-Profile duerfen nicht pro Workspace aendern:

- `providers.<key>.command`
- `providers.<key>.env`
- `providers.<key>.timeoutMs`
- globale Policy (`approvalMode`, `filesystemMode`, `networkMode`, usw.)

Grund:

- weniger Debugging-Komplexitaet
- kein verstecktes pro-Workspace Shell-Verhalten
- keine per-Workspace Sicherheitsdifferenzen

### 3.3 Presets sind Startpunkte, nicht harte Magie

Die eingebauten Presets muessen:

- verstaendlich
- sichtbar
- aenderbar

sein. Sie duerfen nicht als Sonderfall im Resolver versteckt werden. Intern sollen sie zu einem normalen Workspace-Override materialisiert oder referenziert werden.

## 4. Scope

Dieses Arbeitspaket umfasst:

- Workspace-spezifische Runtime-Profile in der Persistence
- Resolver-Logik fuer `global default -> user override -> workspace profile -> CLI override`
- eingebaute Presets `codex_primary` und `claude_primary`
- CLI zum Anzeigen, Anwenden und gezielten Ueberschreiben
- Integration in `workspace:assist` und `workspace:bootstrap`
- Tests und Doku

Dieses Arbeitspaket umfasst bewusst nicht:

- UI-Oberflaeche
- per-Workspace Provider-Commands oder Env
- beliebige freie JSON-Dateien im Workspace als zusaetzliche Runtime-Quelle
- automatische Erkennung der "besten" Profile anhand installierter CLIs

## 5. Zielbild fuer die Aufloesung

Die effektive Runtime wird in dieser Reihenfolge aufgeloest:

1. Installations-Default aus `config/agent-runtime.json`
2. globaler User-Override aus `userDataDir/config/agent-runtime.override.json`
3. Workspace-Profil aus `workspace_settings`
4. expliziter CLI-Override fuer den konkreten Run

Wichtige Regel:

- eine spaetere Ebene ueberschreibt nur die selektiven Runtime-Felder
- globale Provider-Definitionen bleiben aus Ebene 1 und 2

## 6. Datenmodell

### 6.1 Persistence-Entscheidung

Wir fuehren in `workspace_settings` ein neues JSON-Feld ein:

- `runtime_profile_json`

Im TypeScript-Modell:

- `runtimeProfileJson: string | null`

Bestehende Felder wie `defaultAdapterKey` und `defaultModel` bleiben davon unberuehrt, sind fuer dieses Feature aber nicht Teil der Runtime-Aufloesung.

### 6.2 Warum JSON statt einzelner Spalten

Gruende:

- Form ist analog zur globalen Runtime-Konfiguration
- spaetere Erweiterungen brauchen keine neue Migration pro Stage/Worker
- einfacher fuer CLI-Ausgabe und spaeter fuer UI
- die beiden eingebauten Presets lassen sich direkt als JSON anwenden

### 6.3 Workspace-Runtime-Profil-Schema

Neue interne Form:

```json
{
  "version": 1,
  "profileKey": "codex_primary",
  "label": "Codex Primary",
  "defaultProvider": "codex",
  "defaults": {
    "interactive": { "provider": "codex", "model": "gpt-5.5" },
    "autonomous": { "provider": "codex", "model": "gpt-5.5" }
  },
  "interactive": {
    "brainstorm_chat": { "provider": "claude", "model": "claude-sonnet" },
    "story_review_chat": { "provider": "codex", "model": "gpt-5.5" }
  },
  "stages": {
    "brainstorm": { "provider": "claude", "model": "claude-sonnet" },
    "requirements": { "provider": "codex", "model": "gpt-5.5" },
    "architecture": { "provider": "codex", "model": "gpt-5.5" },
    "planning": { "provider": "codex", "model": "gpt-5.5" }
  },
  "workers": {
    "test_preparation": { "provider": "codex", "model": "gpt-5.5" },
    "execution": { "provider": "codex", "model": "gpt-5.5" },
    "ralph": { "provider": "claude", "model": "claude-sonnet" },
    "app_verification": { "provider": "codex", "model": "gpt-5.5" },
    "story_review": { "provider": "claude", "model": "claude-sonnet" },
    "story_review_remediation": { "provider": "codex", "model": "gpt-5.5" },
    "qa": { "provider": "claude", "model": "claude-sonnet" },
    "documentation": { "provider": "claude", "model": "claude-sonnet" }
  },
  "meta": {
    "source": "builtin",
    "description": "Codex handles the code-heavy path; Claude handles cheaper review and docs tasks."
  }
}
```

### 6.4 Feldbedeutung

- `version`
  - Version des Workspace-Profilformats
- `profileKey`
  - optionaler stabiler Schluessel fuer eingebaute oder benannte Profile
- `label`
  - menschenlesbarer Anzeigename
- `defaultProvider`
  - optionaler Workspace-Default fuer Selektionen ohne genaueren Override
- `defaults`, `interactive`, `stages`, `workers`
  - selektive Provider-/Modell-Zuordnung
- `meta`
  - reine Anzeige-/Herkunftsinfo

### 6.5 Validierung

Es braucht ein eigenes Zod-Schema fuer Workspace-Profile:

- strict auf Top-Level
- nur bekannte Stage-/Worker-/Interactive-Keys
- nur `provider` und `model` pro Auswahl
- keine `providers.*`, keine Policy

Ungueltige Profile muessen mit klarer Fehlermeldung abgelehnt werden:

- beim CLI-Apply
- beim Laden des Workspace-Kontexts
- beim Bootstrap/Assist, falls ein Profil aus einer Session uebernommen wird

### 6.6 Versionierung

`version` ist Pflicht und startet bei `1`.

Verhalten fuer die erste Implementierung:

- `version: 1` wird akzeptiert
- jede andere Version wird mit einer klaren Fehlermeldung abgelehnt

Fehlermeldung muss mindestens enthalten:

- die gefundene Version
- dass nur `version: 1` unterstuetzt wird
- die Quelle des Profils
  - Built-in-Datei
  - DB-Feld `runtime_profile_json`

Es gibt in diesem Arbeitspaket noch keine automatische Profilmigration zwischen Versionen.

## 7. Built-in Presets

Die Dateien existieren bereits unter:

- `config/runtime-profiles/codex-primary.json`
- `config/runtime-profiles/claude-primary.json`

Diese Dateien werden First-Class-Eingabequellen.

### 7.1 Preset A: `codex_primary`

Annahme:

- grosses Codex-Abo
- kleineres oder guenstigeres Claude-Abo

Ziel:

- teure code-lastige Schritte auf Codex
- review-/textlastige Nebenpfade auf Claude

Zuordnung:

- `defaults.interactive`: Codex
- `defaults.autonomous`: Codex
- `interactive.brainstorm_chat`: Claude
- `interactive.story_review_chat`: Codex
- `stages.brainstorm`: Claude
- `stages.requirements`: Codex
- `stages.architecture`: Codex
- `stages.planning`: Codex
- `workers.test_preparation`: Codex
- `workers.execution`: Codex
- `workers.ralph`: Claude
- `workers.app_verification`: Codex
- `workers.story_review`: Claude
- `workers.story_review_remediation`: Codex
- `workers.qa`: Claude
- `workers.documentation`: Claude

### 7.2 Preset B: `claude_primary`

Annahme:

- grosses Claude-Abo
- kleineres oder gezieltes Codex-Abo

Ziel:

- breite Last auf Claude
- Codex nur auf den code-intensiven Worker-Pfaden

Zuordnung:

- `defaults.interactive`: Claude
- `defaults.autonomous`: Claude
- `interactive.brainstorm_chat`: Claude
- `interactive.story_review_chat`: Claude
- `stages.brainstorm`: Claude
- `stages.requirements`: Claude
- `stages.architecture`: Claude
- `stages.planning`: Claude
- `workers.test_preparation`: Codex
- `workers.execution`: Codex
- `workers.ralph`: Claude
- `workers.app_verification`: Codex
- `workers.story_review`: Claude
- `workers.story_review_remediation`: Codex
- `workers.qa`: Claude
- `workers.documentation`: Claude

### 7.3 Verhalten bei fehlenden Providern

Ein Preset darf nicht stillschweigend greifen, wenn der referenzierte Provider global nicht definiert ist.

Verhalten:

- `workspace:runtime:apply-profile` scheitert mit klarer Fehlermeldung
- `workspace:assist` soll vor der Empfehlung `workspace:doctor`-Infos beruecksichtigen
- `workspace:runtime:profiles` soll markieren, welche Presets mit der aktuellen Runtime voll kompatibel sind
- `workspace:runtime:show` soll sichtbar machen, ob das aktive Profil mit der aktuellen globalen Runtime valide und kompatibel ist

## 8. Merge- und Resolver-Design

### 8.1 Neue Bausteine

Es braucht eine eigene Workspace-Runtime-Schicht, z. B.:

- `src/shared/workspace-runtime-profile.ts`

Aufgaben:

- Schema fuer Workspace-Profile
- Laden von Built-in-Profilen aus `config/runtime-profiles`
- Merge von globaler Runtime + Workspace-Profil
- Hilfsfunktionen fuer CLI-Ausgabe

### 8.2 Merge-Regeln

Die Merge-Regeln sind:

- `defaultProvider`: spaetere Ebene gewinnt
- `defaults.*`: spaetere Ebene gewinnt pro Slot
- `interactive.*`: spaetere Ebene gewinnt pro Key
- `stages.*`: spaetere Ebene gewinnt pro Key
- `workers.*`: spaetere Ebene gewinnt pro Key
- `providers`: bleiben aus globaler Runtime
- `policy`: bleibt aus globaler Runtime

### 8.3 CLI-Overrides

CLI-Overrides fuer einen konkreten Lauf sollen spaeter ebenfalls dieselbe selektive Form nutzen.

Geplante Einfuehrung:

- zunaechst nur innerhalb neuer `workspace:runtime:*`-Kommandos zum Setzen dauerhafter Workspace-Overrides
- echte per-Run CLI-Selektionsflags sind optional und koennen als Folgearbeit kommen

Hinweis:

- Ebene 4 der Resolver-Kette bleibt architektonisch reserviert
- in diesem Arbeitspaket ist sie noch ein Stub und wird funktional nicht voll ausgebaut

## 9. Interaktion mit bestehenden Workspace-Feldern

`workspace_settings.defaultAdapterKey` und `defaultModel` existieren bereits, werden in diesem Arbeitspaket aber bewusst nicht in die neue Workspace-Runtime-Logik eingebunden.

Entscheidung:

- die neue Workspace-Runtime-Aufloesung kennt nur `runtime_profile_json`
- wenn `runtime_profile_json` `NULL` ist, gilt ausschliesslich die globale Runtime
- `defaultAdapterKey` und `defaultModel` werden von Resolver, CLI, Bootstrap und Assist fuer dieses Feature ignoriert

Begruendung:

- es gibt aktuell noch keinen produktiven Legacy-Bestand
- dadurch entfallen Fallback-, Mirror- und Migrationsregeln
- der erste Wurf bleibt deutlich einfacher, testbarer und robuster

## 10. Migration

### 10.1 Datenbank

Neue Migration:

- `ALTER TABLE workspace_settings ADD COLUMN runtime_profile_json TEXT`

### 10.2 Backfill

Kein harter automatischer Backfill fuer bestehende Workspaces.

Stattdessen:

- `NULL` bedeutet: kein Workspace-Profil gesetzt
- Resolver faellt dann nur auf die globale Runtime zurueck

### 10.3 Repos und Dateien

Keine Migration in Workspace-Dateien noetig.

Die Preset-Dateien liegen weiterhin im Installationsbaum und werden read-only geladen.

## 11. CLI-Design

### 11.1 Mindestumfang

Diese Kommandos sollen zuerst kommen:

- `workspace:runtime:show`
- `workspace:runtime:profiles`
- `workspace:runtime:apply-profile --profile <profileKey>`
- `workspace:runtime:clear-profile`
- `workspace:runtime:set-stage --stage <stage> --provider <provider> [--model <model>]`
- `workspace:runtime:set-worker --worker <worker> --provider <provider> [--model <model>]`
- `workspace:runtime:set-interactive --flow <flow> --provider <provider> [--model <model>]`

Optional spaeter:

- `workspace:runtime:set-default --mode interactive|autonomous --provider <provider> [--model <model>]`
- `workspace:runtime:clear-slot --scope stage|worker|interactive|default --key <key>`

### 11.2 Ausgabe von `workspace:runtime:show`

Soll anzeigen:

- globale Runtime-Config-Quelle
- Workspace-Profil-Quelle
- aktives `profileKey` und `label`
- effektive Zuordnung fuer:
  - `defaults`
  - `interactive`
  - `stages`
  - `workers`
- optional Herkunft je Eintrag:
  - `global`
  - `workspace_profile`

### 11.3 Verhalten von `workspace:runtime:apply-profile`

Ablauf:

1. Built-in-Profil laden
2. gegen Workspace-Profil-Schema validieren
3. gegen globale Runtime pruefen
   - referenzierte Provider muessen existieren
4. in `workspace_settings.runtime_profile_json` speichern
5. Ausgabe der effektiven Runtime nach dem Apply

### 11.4 Verhalten von `set-*`

Die `set-*`-Kommandos schreiben nicht rohe Teilstuecke irgendwohin, sondern:

1. existierendes Workspace-Profil laden oder leeres Profil initialisieren
2. den betroffenen Slot aendern
3. Profil validieren
4. speichern

## 12. Integration in `workspace:assist` und `workspace:bootstrap`

### 12.1 Ziel

Der Nutzer soll waehrend Setup/Assist eine sinnvolle Runtime-Strategie auswaehlen koennen, ohne JSON schreiben zu muessen.

### 12.2 Bootstrap

`workspace:bootstrap` soll eine neue Option bekommen:

- `--runtime-profile <profileKey>`

Verhalten:

- vor oder waehrend Bootstrap auf den Workspace anwenden
- nur erlaubte Built-in-Profile
- wenn bereits ein Profil gesetzt ist, ueberschreibt `--runtime-profile` dieses bewusst
- die CLI-Ausgabe muss den Overwrite explizit benennen

Keine interaktive Rueckfrage im CLI-Default-Flow:

- BeerEngineer arbeitet standardmaessig autonom
- der Overwrite ist hier ein expliziter Benutzerwunsch durch den gesetzten Flag

### 12.3 Assist

Der Assist-Flow soll die Profilwahl in den Plan integrieren.

Erweiterungen am Planmodell:

- `runtimeProfileKey?: string | null`

Erweiterungen an der Session-/Plananzeige:

- sichtbare Anzeige des vorgeschlagenen Profils
- sichtbarer Hinweis, ob das Profil bereits auf den Workspace angewendet wurde

### 12.4 Assist-Fragebild

Die Assist-Logik soll auf ein kleines, robustes Set zielen:

- `codex_primary`
- `claude_primary`
- `manual_custom`

Die Frage soll nicht als freier Roman erzwungen werden, sondern als klare Empfehlung im Assist-Text auftauchen.

Bedeutung von `manual_custom`:

- Assist waehlt kein Built-in-Profil aus
- Assist erklaert knapp die empfohlenen naechsten Schritte:
  - `workspace:runtime:profiles`
  - `workspace:runtime:show`
  - `workspace:runtime:set-stage`
  - `workspace:runtime:set-worker`
  - `workspace:runtime:set-interactive`
- Assist darf optional einen Startvorschlag machen, materialisiert aber kein Profil automatisch
- `runtimeProfileKey` im Assist-Plan bleibt in diesem Fall `null`

Falls die Harness-Lage unklar ist:

- Assist soll `workspace:doctor`-Probleme benennen
- und ggf. `manual_custom` oder eine spaetere Runtime-Konfiguration empfehlen

## 13. Implementierungsschritte

### Phase 1: Typen, Schema, Migration

1. `workspace_settings.runtime_profile_json` in Schema, Migration und Repository aufnehmen
2. Domain-Typ `WorkspaceSettings` erweitern
3. Zod-Schema fuer Workspace-Profile bauen
4. Helper zum Laden der Built-in-Profile bauen

### Phase 2: Resolver

1. globalen Runtime-Load unveraendert lassen
2. Workspace-Profil aus `workspace_settings` laden und validieren
3. effektive Runtime mergen
4. `createAppContext()` und Resolver-Nutzer auf die neue Schicht umstellen

### Phase 3: CLI

1. `workspace:runtime:profiles`
2. `workspace:runtime:show`
3. `workspace:runtime:apply-profile`
4. `workspace:runtime:clear-profile`
5. `workspace:runtime:set-stage`
6. `workspace:runtime:set-worker`
7. `workspace:runtime:set-interactive`

Fuer alle mutierenden `set-*`-Kommandos gilt zusaetzlich:

- der angegebene Provider muss gegen die global effektive Runtime validiert werden
- unbekannte Provider werden beim Speichern abgelehnt, nicht erst zur Laufzeit
- nach jeder Mutation wird das komplette Workspace-Profil erneut gegen Schema und globale Providerliste validiert

### Phase 4: Setup/Assist

1. `workspace:bootstrap --runtime-profile`
2. Assist-Plan um `runtimeProfileKey`
3. Assist-Ausgabe und Session-Anzeige erweitern
4. Resolve-/Bootstrap-Pfad so verdrahten, dass das Profil angewendet werden kann

### Phase 5: Doku

1. CLI-Referenz
2. Architektur-/Runtime-Doku
3. Setup-/Assist-Doku
4. README mit den zwei empfohlenen Einstiegsprofilen

## 14. Tests

Mindestens abdecken:

- Migration fuegt `runtime_profile_json` hinzu
- Repository liest und schreibt `runtimeProfileJson`
- Built-in-Profile lassen sich laden und validieren
- Mapping `profileKey -> Built-in-Datei` ist explizit und korrekt
- unbekannte Built-in-Keys werden sauber abgelehnt
- unbekannte Profilversionen werden sauber abgelehnt
- `codex_primary` liefert die erwarteten Zuweisungen
- `claude_primary` liefert die erwarteten Zuweisungen
- korrupte oder invalide JSON-Werte in `workspace_settings.runtime_profile_json` werden sauber abgelehnt
- Workspace-Profil ueberschreibt Stage-Auswahl
- Workspace-Profil ueberschreibt Worker-Auswahl
- Workspace-Profil ueberschreibt Interactive-Flow
- global definierte Provider bleiben erhalten
- verbotene Workspace-Profil-Felder werden abgelehnt
- unbekannte Provider im Workspace-Profil werden abgelehnt
- `set-*` lehnt unbekannte Provider beim Speichern ab
- voller Resolver-Kettentest mit allen 4 Ebenen:
  - Installations-Default
  - User-Override
  - Workspace-Profil
  - CLI-Override-Stub oder aequivalente Testeinspeisung
- `workspace:runtime:apply-profile` speichert korrekt
- `workspace:runtime:set-stage` aktualisiert nur den Zielslot
- `workspace:runtime:show` zeigt effektive Werte und Quellen
- `workspace:runtime:show` zeigt Kompatibilitaet des aktiven Profils
- `workspace:bootstrap --runtime-profile` wendet das Profil an
- `workspace:bootstrap --runtime-profile` benennt ein bestehendes Profil als ueberschrieben
- Assist-Plan transportiert `runtimeProfileKey`
- `manual_custom` fuehrt im Assist-Plan zu keinem automatisch materialisierten Profil

## 15. Offene Entscheidungen

Diese Punkte muessen waehrend der Umsetzung bewusst entschieden werden:

- ob `apply-profile` das Profil exakt ersetzt oder mit bestehenden manuellen Overrides merged
  - Empfehlung: exakt ersetzen
- ob `clear-profile` auch Legacy-Fallbacks unsichtbar machen soll
  - Empfehlung: nein, Legacy-Fallbacks bleiben fuer Alt-Workspaces aktiv
- ob `set-*` auf einem Built-in-Profil aufbauen und dieses direkt weiter mutieren darf
  - Empfehlung: ja, aber sobald ein Built-in-Profil manuell per `set-*` veraendert wird, wird `profileKey` geleert und `meta.source` auf `workspace_custom` gesetzt
  - das verhindert irrefuehrende Anzeige eines nicht mehr unveraenderten Built-ins

## 16. Erfolgskriterien

- pro Workspace ist sichtbar, welcher Harness und welches Modell pro Schritt gilt
- zwei sinnvolle Start-Presets sind sofort nutzbar
- mehrere Workspaces koennen im selben Repo unterschiedliche Runtime-Strategien nutzen
- Workspace-Profile bleiben debugbar, weil Commands, Env, Timeouts und Policy global bleiben
- Setup und Assist koennen eine Profilentscheidung ohne JSON-Handarbeit ausloesen
- Resolver, CLI und Persistenz lehnen invalide Profile frueh und mit klarer Quelle ab
