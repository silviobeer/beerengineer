# Workspace Runtime Profiles Implementation Plan

## 1. Ziel

BeerEngineer soll pro Workspace klar steuern koennen,

- welcher Harness standardmaessig pro Schritt verwendet wird
- welches Modell pro Schritt verwendet wird
- welche sinnvollen Presets ein Nutzer mit grossem Haupt-Abo und kleinem Neben-Abo sofort waehlen kann

Das System soll dabei:

- die bestehende globale Runtime-Config weiter nutzen
- workspace-spezifische Overrides sauber darueberlegen
- einen einfachen Setup-Pfad fuer die erste Auswahl bieten

## 2. Warum dieses Arbeitspaket noetig ist

Heute existiert bereits eine globale Runtime-Konfiguration in:

- `config/agent-runtime.json`
- optional `userDataDir/config/agent-runtime.override.json`

Und es gibt in `workspace_settings` schon einfache Felder:

- `defaultAdapterKey`
- `defaultModel`

Das reicht aber nicht, um pro Workspace wirklich nuetzliche Entscheidungen zu
treffen wie:

- Codex als teurer Haupt-Harness fuer die code-intensiven Schritte
- Claude als guenstigerer Neben-Harness fuer Reviews, Doku oder Brainstorm
- oder das gleiche Muster spiegelverkehrt

## 3. Leitprinzip

Die globale Runtime-Datei bleibt die Produkt-Basis.

Workspace-Profile sollen diese Basis nicht ersetzen, sondern nur gezielt
ueberschreiben.

Die Aufloesung muss nachvollziehbar bleiben.

## 4. Zielbild

Die effektive Runtime fuer einen konkreten Run wird in dieser Reihenfolge
aufgeloest:

1. Installations-Default
2. globaler User-Override aus `userDataDir`
3. Workspace-Runtime-Profil
4. expliziter CLI-Override fuer den konkreten Lauf

Die wichtigste neue Ebene ist also:

- Workspace-Runtime-Profil

## 5. Konfigurationsmodell

### Global

Bleibt wie heute:

- `config/agent-runtime.json`
- optional `userDataDir/config/agent-runtime.override.json`

### Workspace

Neue workspace-spezifische Struktur in `workspace_settings`, z. B.:

- `runtimeProfileJson`

Empfohlene Form:

```json
{
  "profileKey": "codex_primary",
  "label": "Codex Primary",
  "defaults": {
    "interactive": { "provider": "codex", "model": "gpt-5.4" },
    "autonomous": { "provider": "codex", "model": "gpt-5.4" }
  },
  "interactive": {
    "brainstorm_chat": { "provider": "claude", "model": "sonnet" },
    "story_review_chat": { "provider": "codex", "model": "gpt-5.4" }
  },
  "stages": {
    "brainstorm": { "provider": "claude", "model": "sonnet" },
    "requirements": { "provider": "codex", "model": "gpt-5.4" },
    "architecture": { "provider": "codex", "model": "gpt-5.4" },
    "planning": { "provider": "codex", "model": "gpt-5.4" }
  },
  "workers": {
    "test_preparation": { "provider": "codex", "model": "gpt-5.4" },
    "execution": { "provider": "codex", "model": "gpt-5.4" },
    "ralph": { "provider": "claude", "model": "sonnet" },
    "app_verification": { "provider": "codex", "model": "gpt-5.4" },
    "story_review": { "provider": "claude", "model": "sonnet" },
    "story_review_remediation": { "provider": "codex", "model": "gpt-5.4" },
    "qa": { "provider": "claude", "model": "sonnet" },
    "documentation": { "provider": "claude", "model": "sonnet" }
  }
}
```

Wichtig:

- Workspace-Profile ueberschreiben nur Selektionen
- `providers`, `command`, `env`, `timeoutMs` bleiben global
- Policies wie YOLO/approval/network bleiben global und muessen weiterhin
  zentral validiert werden

## 6. Zwei sinnvolle Start-Presets

### Preset A: `codex_primary`

Annahme:

- Nutzer hat grosses Codex-Abo
- Claude ist verfuegbar, aber eher kleiner oder guenstiger

Ziel:

- teure, code-lastige Schritte auf Codex
- review-/textlastige Nebenpfade auf Claude

Empfohlene Zuordnung:

- `brainstorm_chat`: Claude
- `story_review_chat`: Codex
- `brainstorm` Stage: Claude
- `requirements`: Codex
- `architecture`: Codex
- `planning`: Codex
- `test_preparation`: Codex
- `execution`: Codex
- `ralph`: Claude
- `app_verification`: Codex
- `story_review`: Claude
- `story_review_remediation`: Codex
- `qa`: Claude
- `documentation`: Claude

Begruendung:

- Codex verbraucht die meisten Tokens dort, wo tiefer Code- und Repo-Kontext
  zaehlt
- Claude faengt guenstigere, textlastige und review-artige Rollen ab

### Preset B: `claude_primary`

Annahme:

- Nutzer hat grosses Claude-Abo
- Codex ist verfuegbar, aber kleiner oder gezielter einsetzbar

Ziel:

- breite Standardlast auf Claude
- Codex nur dort, wo gezielte Code- oder Testausfuehrung besonders wertvoll ist

Empfohlene Zuordnung:

- `brainstorm_chat`: Claude
- `story_review_chat`: Claude
- `brainstorm` Stage: Claude
- `requirements`: Claude
- `architecture`: Claude
- `planning`: Claude
- `test_preparation`: Codex
- `execution`: Codex
- `ralph`: Claude
- `app_verification`: Codex
- `story_review`: Claude
- `story_review_remediation`: Codex
- `qa`: Claude
- `documentation`: Claude

Begruendung:

- Claude uebernimmt den Grossteil der text- und reviewlastigen Arbeit
- Codex bleibt fuer die code-intensiven Worker reserviert

## 7. Setup-Flow

Ja: Beim Setup sollte der Nutzer gefragt werden, was er will.

Aber nicht als freie Roman-Eingabe, sondern als einfache, robuste Auswahl.

Empfohlene Setup-Frage:

- Welcher Harness soll dein primaerer High-Usage-Agent sein?
  - `codex_primary`
  - `claude_primary`
  - `manual_custom`

Optional zweite Frage:

- Soll der zweite Harness fuer guenstigere Review-/Dokuschritte automatisch
  genutzt werden, wenn konfiguriert?
  - `yes`
  - `no`

## 8. CLI-Oberflaeche

Empfohlene neue Commands:

- `workspace:runtime:show`
- `workspace:runtime:profiles`
- `workspace:runtime:apply-profile --profile codex_primary|claude_primary`
- `workspace:runtime:set-stage --stage <stage> --provider <provider> --model <model>`
- `workspace:runtime:set-worker --worker <worker> --provider <provider> --model <model>`
- `workspace:runtime:clear-overrides`

Optional fuer Setup:

- `workspace:bootstrap --runtime-profile codex_primary|claude_primary`
- oder im `workspace:assist`-Pfad als empfohlene Frage/Aktion

## 9. Aufloesungslogik im Code

### Neue Resolver-Schicht

Die aktuelle Runtime-Aufloesung sollte erweitert werden:

- globale Runtime-Datei laden
- optionalen globalen User-Override mergen
- workspace-spezifisches Runtime-Profil mergen
- danach explizite CLI-Overrides anwenden

### Wichtige Regel

Workspace-Profile duerfen nur Provider-/Modell-Selektion aendern, nicht:

- `providers.<key>.command`
- `providers.<key>.env`
- `providers.<key>.timeoutMs`
- globale Policy

Das verhindert schwer debuggbare per-Workspace Shell-Unterschiede.

## 10. Persistence

Empfohlene minimale Erweiterung:

- neues Feld `workspace_settings.runtimeProfileJson`

Warum ein Feld statt vieler Spalten:

- gleiche Form wie die globale Runtime-Konfiguration
- leicht versionierbar
- spaeter leicht fuer UI editierbar

## 11. Doku

Nach Umsetzung dokumentieren:

- globale Runtime-Dateien
- workspace-spezifische Runtime-Profile
- die beiden mitgelieferten Presets
- wie die effektive Runtime-Aufloesung bestimmt wird

## 12. Tests

Mindestens abdecken:

- globale Runtime ohne Workspace-Profil
- Workspace-Profil ueberschreibt Stage-Auswahl
- Workspace-Profil ueberschreibt Worker-Auswahl
- CLI-Override gewinnt gegen Workspace-Profil
- `codex_primary` liefert die erwarteten Zuordnungen
- `claude_primary` liefert die erwarteten Zuordnungen
- invalide Workspace-Profile werden sauber abgelehnt

## 13. Umsetzungsreihenfolge

1. `workspace_settings` um `runtimeProfileJson` erweitern
2. Merge-/Resolver-Logik fuer Workspace-Profile einfuehren
3. zwei eingebaute Presets definieren
4. CLI zum Anzeigen und Anwenden von Profilen bauen
5. Setup-/Assist-Pfad um die Profilfrage erweitern
6. Tests ergaenzen
7. Referenzdoku aktualisieren

## 14. Erfolgskriterien

- pro Workspace ist klar sichtbar, welcher Harness/ welches Modell pro Schritt gilt
- zwei sinnvolle Start-Presets sind sofort nutzbar
- die meisten Tokens landen beim primaeren Gross-Abo-Harness
- der zweite Harness kann bewusst fuer guenstigere Nebenrollen genutzt werden
- die effektive Runtime-Aufloesung bleibt deterministisch und debugbar
