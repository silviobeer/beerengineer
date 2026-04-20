# Update-Safe Persistence Implementation Plan

## 1. Ziel

BeerEngineer so aufstellen, dass Produkt-Updates den installierten App-Code ersetzen koennen, ohne bestehende Nutzerdaten, SQLite-Datenbanken, Workspace-Metadaten oder projektbezogene Artefakte zu ueberschreiben.

Kernidee:

- installierter App-Code ist austauschbar
- persistente Engine-Daten leben in einem stabilen User-Data-Verzeichnis
- Projektdateien und projektbezogene Artefakte leben weiter in den jeweiligen Workspace-Roots

## 2. Ist-Zustand

Aktuell ist die Trennung nur teilweise vorhanden:

- die SQLite-DB ist bereits ueber `--db` frei platzierbar
- Migrationen laufen beim Start automatisch
- fachlicher `Workspace` und technischer `workspaceRoot` sind bereits getrennt
- projektbezogene Artefakte werden bewusst im Workspace unter `.beerengineer/artifacts/` materialisiert

Aber:

- der CLI-Default fuer `--db` ist relativ: `./var/data/beerengineer.sqlite`
- es gibt keinen kanonischen `userDataDir`
- Runtime-Konfiguration und andere engine-eigene Persistenz sind nicht systematisch an ein update-sicheres Datenverzeichnis gebunden
- das System verhindert aktuell nicht, dass ein `workspaceRoot` im installierten App-Verzeichnis liegt

## 3. Zielbild

Nach Umsetzung gilt:

- BeerEngineer besitzt ein kanonisches, OS-spezifisches `userDataDir`
- die Standard-SQLite-DB liegt dort
- engine-eigene Logs, Caches und lokale Runtime-Overrides liegen dort
- Workspace-Projektordner bleiben davon getrennt
- `.beerengineer/artifacts/` bleibt im Projekt-Workspace fuer projektbezogene Outputs
- Updates ersetzen nur den App-Code, nicht `userDataDir` und nicht Workspace-Roots

## 4. Architekturentscheidung

Es gibt drei klar getrennte Speicherzonen:

1. Installations-/Codeverzeichnis
- Binary, JS-Bundle, Default-Konfiguration, statische Assets
- darf bei Updates voll ersetzt werden

2. Engine User Data Directory
- SQLite-DB
- engine-eigene Logs
- Cache-Dateien
- lokale Runtime-Override-Dateien
- update-sicher und langlebig

3. Workspace Root
- Nutzerprojekt / bearbeitete App
- `.beerengineer/artifacts/`
- Git-Worktrees
- projektbezogene Reports, Verifikationsartefakte und Delivery-Reports

Wichtig:

- engine-interne Persistenz gehoert nicht in den Installationsordner
- projektbezogene Persistenz gehoert nicht in das globale `userDataDir`

## 5. Verzeichnisstrategie

Empfohlene Defaults:

- Linux:
  - `XDG_DATA_HOME/beerengineer` oder `~/.local/share/beerengineer`
- macOS:
  - `~/Library/Application Support/beerengineer`
- Windows:
  - `%APPDATA%/beerengineer`

Innerhalb dieses Verzeichnisses:

- `beerengineer.sqlite`
- `logs/`
- `cache/`
- `config/agent-runtime.override.json` falls spaeter noetig

Projektbezogene Outputs bleiben im Workspace:

- `<workspaceRoot>/.beerengineer/artifacts/`
- `<workspaceRoot>/.beerengineer/worktrees/`

## 6. Arbeitspaket A: `userDataDir` einfuehren

Ziel:

- einen zentralen Resolver fuer den langlebigen Datenpfad schaffen

Aufgaben:

- neuen Resolver einfuehren, z. B. `resolveUserDataDir()`
- OS-spezifische Defaults implementieren
- Umgebungsvariablen sauber beruecksichtigen:
  - `XDG_DATA_HOME`
  - `APPDATA`
  - Home-Verzeichnis als Fallback
- Fehlerfall fuer nicht aufloesbare Home-/Systempfade definieren

Ergebnis:

- eine einzige Quelle der Wahrheit fuer engine-eigene Persistenz

## 7. Arbeitspaket B: CLI-Default fuer `--db` umstellen

Ziel:

- die Standarddatenbank update-sicher machen

Aufgaben:

- Default in der CLI nicht mehr als relativen Pfad hardcoden
- stattdessen `resolveDefaultDbPath()` verwenden
- Pfad aus `userDataDir/beerengineer.sqlite` ableiten
- bestehenden `--db`-Override voll erhalten

Ergebnis:

- ohne explizite Flags landet die DB automatisch im sicheren Datenverzeichnis

## 8. Arbeitspaket C: Engine-eigene Persistenz an `userDataDir` binden

Ziel:

- alle nicht projektbezogenen Dateien aus dem Installationspfad fernhalten

Aufgaben:

- pruefen, welche Laufzeitdateien heute implizit im Repo-/Installationspfad erwartet werden
- engine-eigene Logs nach `userDataDir/logs` verlagern
- spaetere Cache-/State-Dateien nur dort materialisieren
- trennen zwischen:
  - engine-global
  - workspace-projektbezogen

Nicht Teil dieses Pakets:

- projektbezogene Artefakte aus `.beerengineer/artifacts/` herausziehen

## 9. Arbeitspaket D: Workspace-Guards gegen unsichere Roots

Ziel:

- verhindern, dass Nutzer versehentlich den installierten App-Ordner als Workspace verwenden

Aufgaben:

- Heuristik fuer Installations-/Repo-Root definieren
- Guard in `workspace:create`, `workspace:update-root` und Kontextaufloesung einbauen
- mindestens Warnung, besser harter Fehler fuer:
  - `workspaceRoot` liegt innerhalb des Installationspfads
  - `workspaceRoot` ist identisch mit dem Engine-Repo-Root
- Escape-Hatch nur bewusst und explizit, falls ueberhaupt

Ergebnis:

- Updates koennen den App-Code ersetzen, ohne dass gleichzeitig Nutzer-Workspaces im selben Baum liegen

## 10. Arbeitspaket E: Migration und Rueckwaertskompatibilitaet

Ziel:

- bestehende Nutzer mit relativen oder alten DB-Pfaden nicht brechen

Aufgaben:

- vorhandene explizite `--db`-Pfadnutzung unveraendert lassen
- nur den Default umstellen
- optional spaeter:
  - beim Start erkennen, wenn alte Default-DB unter `./var/data/beerengineer.sqlite` liegt
  - informative Warnung oder Migrationshilfe ausgeben
- keine automatische DB-Verschiebung ohne klares Nutzer-Signal

Ergebnis:

- bestehende Setups bleiben funktionsfaehig
- neue Setups starten update-sicher

## 11. Arbeitspaket F: Dokumentation nachziehen

Ziel:

- Update-/Installationsmodell klar dokumentieren

Aufgaben:

- CLI-Referenz fuer neuen DB-Default aktualisieren
- Betriebsdoku fuer:
  - Installationspfad
  - `userDataDir`
  - Workspace-Roots
  - Backup/Restore der SQLite-DB
- Troubleshooting fuer Update-Faelle ergaenzen
- klar dokumentieren:
  - was bei Updates ersetzt werden darf
  - was nicht ersetzt werden darf

## 12. Tests

Mindestens abdecken:

- `resolveUserDataDir()` auf Linux/macOS/Windows-Varianten
- neuer CLI-DB-Default zeigt in `userDataDir`
- `--db` ueberschreibt den Default weiterhin
- DB-Verzeichnis wird bei Bedarf automatisch erzeugt
- bestehende Migrationen laufen mit dem neuen Default unveraendert
- Workspace-Guard greift fuer Root-Pfade im Installations-/Repo-Baum

## 13. Risiken und bewusste Nicht-Ziele

Bewusst nicht Teil dieses Plans:

- projektbezogene Artefakte aus Workspace-Roots in ein globales Datenverzeichnis verschieben
- Installer-/Packaging-spezifische Umsetzung fuer jede Plattform
- automatische Kopie bestehender alter Default-Datenbanken ohne Nutzerentscheidung

Risiken:

- falsche Pfadauflosung auf Plattformen ohne erwartete Env-Variablen
- Tests, die den alten relativen DB-Default implizit erwarten
- Verwechslung zwischen fachlichem Workspace und technischem `workspaceRoot`

## 14. Umsetzungsreihenfolge

1. `resolveUserDataDir()` und `resolveDefaultDbPath()` einfuehren
2. CLI-Default fuer `--db` umstellen
3. gezielte Tests fuer Defaultpfade und Overrides ergaenzen
4. Workspace-Guards gegen Installations-/Repo-Roots einfuehren
5. Doku fuer Update-/Persistenzmodell nachziehen
6. optional spaetere Migrationshilfe fuer alte relative Default-DBs ergaenzen

## 15. Erfolgskriterien

- eine neue Installation erzeugt ihre DB nicht mehr im aktuellen Arbeitsverzeichnis
- ein App-Update ueberschreibt keine DB und keine engine-globalen Laufzeitdaten
- projektbezogene Artefakte bleiben im jeweiligen Workspace erhalten
- bestehende explizite `--db`-basierte Setups funktionieren unveraendert
- das System erschwert oder verhindert Workspaces im Installationspfad
