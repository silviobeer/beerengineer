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
- die Runtime-Konfiguration wird standardmaessig direkt aus `config/agent-runtime.json` im Repo-/Installationsbaum geladen
- es gibt noch keine saubere Trennung zwischen statischer Default-Konfiguration im Installationsbaum und optionalen lokalen User-Overrides
- weitere mutable Engine-Konfiguration hat noch keinen kanonischen, update-sicheren Ablageort
- projektbezogene Konfigurationsdateien wie `.env.local`, `sonar-project.properties` oder `coderabbit.md` muessen konzeptionell klar vom engine-globalen Konfigurationsraum getrennt bleiben
- `createAppContext()` faellt fuer `workspaceRoot` heute implizit auf `repoRoot` zurueck, was fuer installierte Builds und lokale Repo-Nutzung riskant ist
- das System verhindert aktuell nicht, dass ein `workspaceRoot` im installierten App-Verzeichnis liegt
- `workspace:create` und `workspace:update-root` schreiben Roots heute ohne Installations-/Repo-Guard direkt in die DB

## 3. Zielbild

Nach Umsetzung gilt:

- BeerEngineer besitzt ein kanonisches, OS-spezifisches `userDataDir`
- die Standard-SQLite-DB liegt dort
- engine-eigene Logs, Caches und lokale Runtime-Overrides liegen dort
- engine-globale mutable Konfiguration liegt nicht mehr implizit im Installationsbaum
- Workspace-Projektordner bleiben davon getrennt
- projektbezogene Konfigurationsdateien bleiben im jeweiligen Workspace
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
- engine-globale mutable Konfiguration
- update-sicher und langlebig

3. Workspace Root
- Nutzerprojekt / bearbeitete App
- projektbezogene Konfigurationsdateien wie `.env.local`, `sonar-project.properties`, `coderabbit.md`
- `.beerengineer/artifacts/`
- Git-Worktrees
- projektbezogene Reports, Verifikationsartefakte und Delivery-Reports

Wichtig:

- engine-interne Persistenz gehoert nicht in den Installationsordner
- projektbezogene Persistenz gehoert nicht in das globale `userDataDir`
- statische Produkt-Defaults duerfen im Installationsbaum liegen, mutable User-Overrides dagegen nicht
- workspace-spezifische Konfiguration gehoert in den Workspace und nicht in das globale `userDataDir`

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
- `config/agent-runtime.override.json` fuer optionale lokale Overrides

Wichtig fuer die Runtime-Konfiguration:

- `config/agent-runtime.json` im Installationsbaum bleibt die read-only Produkt-Default-Konfiguration
- nur lokale, mutable Overrides gehoeren spaeter nach `userDataDir/config/`
- dieses Arbeitspaket verschiebt nicht die kanonische Default-Datei aus dem Installationsbaum heraus, sondern trennt Default und Override sauber

Wichtig fuer andere Konfigurationsdateien:

- engine-globale, mutable Konfiguration folgt derselben Regel wie Runtime-Overrides und gehoert nach `userDataDir/config/`
- projektbezogene Konfigurationsdateien bleiben im Workspace-Root
- dieses Arbeitspaket zieht bewusst keine Workspace-Konfiguration aus dem Projekt heraus

Projektbezogene Outputs bleiben im Workspace:

- `<workspaceRoot>/.beerengineer/artifacts/`
- `<workspaceRoot>/.beerengineer/worktrees/`

## 6. Arbeitspaket A: `userDataDir` einfuehren

Ziel:

- einen zentralen Resolver fuer den langlebigen Datenpfad schaffen

Aufgaben:

- neuen Resolver einfuehren, z. B. `resolveUserDataDir()`
- dazu einen expliziten Resolver `resolveDefaultDbPath()`
- OS-spezifische Defaults implementieren
- Umgebungsvariablen sauber beruecksichtigen:
  - `XDG_DATA_HOME`
  - `APPDATA`
  - Home-Verzeichnis als Fallback
- `HOME` bzw. `USERPROFILE` als Fallback sauber behandeln
- Fehlerfall fuer nicht aufloesbare Home-/Systempfade definieren

Ergebnis:

- eine einzige Quelle der Wahrheit fuer engine-eigene Persistenz
- kein CLI- oder App-Context-Code berechnet Default-Pfade mehr inline

## 7. Arbeitspaket B: CLI-Default fuer `--db` umstellen

Ziel:

- die Standarddatenbank update-sicher machen

Aufgaben:

- Default in der CLI nicht mehr als relativen Pfad hardcoden
- stattdessen `resolveDefaultDbPath()` verwenden
- Pfad aus `userDataDir/beerengineer.sqlite` ableiten
- bestehenden `--db`-Override voll erhalten
- darauf achten, dass Tests und Helper-Utilities nicht versehentlich weiterhin den alten relativen Default implizit annehmen

Ergebnis:

- ohne explizite Flags landet die DB automatisch im sicheren Datenverzeichnis

## 8. Arbeitspaket C: Engine-eigene Persistenz an `userDataDir` binden

Ziel:

- alle nicht projektbezogenen Dateien aus dem Installationspfad fernhalten

Aufgaben:

- pruefen, welche Laufzeitdateien heute implizit im Repo-/Installationspfad erwartet werden
- insbesondere trennen zwischen:
  - statischer Default-Config im Installationsbaum
  - mutablem Runtime-State im `userDataDir`
- engine-eigene Logs nach `userDataDir/logs` verlagern
- spaetere Cache-/State-Dateien nur dort materialisieren
- optionalen Runtime-Override-Pfad vorbereiten, ohne sofort ein Merge-System fuer alle Settings erzwingen zu muessen
- allgemeine Konfigurationsregel dokumentieren:
  - engine-global + mutable => `userDataDir/config/`
  - projektbezogen => Workspace-Root
- trennen zwischen:
  - engine-global
  - workspace-projektbezogen

Nicht Teil dieses Pakets:

- projektbezogene Artefakte aus `.beerengineer/artifacts/` herausziehen
- die kanonische Default-Datei `config/agent-runtime.json` aus dem Installationsbaum entfernen
- Workspace-Konfigurationsdateien wie `.env.local`, `sonar-project.properties` oder `coderabbit.md` in ein globales Verzeichnis verschieben

## 8a. Arbeitspaket C2: Konfigurationslade-Reihenfolge explizit machen

Ziel:

- klar definieren, welche Konfiguration aus welchem Speicherbereich stammt und wie sie kombiniert wird

Aufgaben:

- eine explizite Lade-Reihenfolge fuer engine-globale Runtime-Konfiguration festlegen:
  - Installations-Default
  - optionaler User-Override aus `userDataDir`
  - expliziter CLI-Pfad
- festlegen, welche Konfiguration bewusst nicht gemerged wird, sondern komplett per CLI-Pfad ersetzt werden darf
- klar trennen zwischen:
  - engine-globaler Konfiguration
  - workspace-spezifischer Projektkonfiguration
  - in der DB gespeicherten Workspace-Einstellungen

Ergebnis:

- Konfigurationsquellen sind nachvollziehbar, update-sicher und ohne implizite Repo-Abhaengigkeit

## 9. Arbeitspaket D: Workspace-Guards gegen unsichere Roots

Ziel:

- verhindern, dass Nutzer versehentlich den installierten App-Ordner als Workspace verwenden

Aufgaben:

- Heuristik fuer Installations-/Repo-Root definieren
- Guard in `workspace:create`, `workspace:update-root` und Kontextaufloesung einbauen
- den heutigen impliziten `repoRoot`-Fallback in `createAppContext()` und verwandten Pfaden als unsicheren Default behandeln und durch einen expliziten, nachvollziehbaren Aufloesungspfad ersetzen
- mindestens Warnung, besser harter Fehler fuer:
  - `workspaceRoot` liegt innerhalb des Installationspfads
  - `workspaceRoot` ist identisch mit dem Engine-Repo-Root
- auch fuer den Fall:
  - `--workspace-root` fehlt und nur deshalb auf den Installations-/Repo-Pfad gefallen wuerde
- Escape-Hatch nur bewusst und explizit, falls ueberhaupt

Ergebnis:

- Updates koennen den App-Code ersetzen, ohne dass gleichzeitig Nutzer-Workspaces im selben Baum liegen
- Workspace-Setup-Kommandos und regulaere App-Contexts verhalten sich dabei konsistent

## 10. Arbeitspaket E: Migration und Rueckwaertskompatibilitaet

Ziel:

- bestehende Nutzer mit relativen oder alten DB-Pfaden nicht brechen

Aufgaben:

- vorhandene explizite `--db`-Pfadnutzung unveraendert lassen
- nur den Default umstellen
- bestehende Tests mit expliziten Temp-DB-Pfaden sollen unveraendert weiterlaufen
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
- Konfigurationsmodell fuer:
  - Installations-Default-Dateien
  - `userDataDir/config/`
  - Workspace-Konfigurationsdateien
  - CLI-Overrides
  dokumentieren
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
- `resolveDefaultDbPath()` baut deterministisch auf `resolveUserDataDir()` auf
- neuer CLI-DB-Default zeigt in `userDataDir`
- `--db` ueberschreibt den Default weiterhin
- DB-Verzeichnis wird bei Bedarf automatisch erzeugt
- bestehende Migrationen laufen mit dem neuen Default unveraendert
- Workspace-Guard greift fuer Root-Pfade im Installations-/Repo-Baum
- `workspace:create` und `workspace:update-root` lehnen unsichere Roots ab
- Kontextaufloesung ohne expliziten `--workspace-root` faellt nicht stillschweigend auf einen unsicheren Repo-/Installationspfad zurueck
- statische Runtime-Default-Config bleibt aus dem Installationsbaum ladbar, waehrend ein spaeterer Override-Pfad sauber nach `userDataDir` zeigen kann
- die Konfigurationslade-Reihenfolge `Installations-Default -> User-Override -> CLI-Pfad` ist testbar und eindeutig
- Workspace-spezifische Konfigurationsdateien bleiben vom engine-globalen Konfigurationspfad unberuehrt

## 13. Risiken und bewusste Nicht-Ziele

Bewusst nicht Teil dieses Plans:

- projektbezogene Artefakte aus Workspace-Roots in ein globales Datenverzeichnis verschieben
- Installer-/Packaging-spezifische Umsetzung fuer jede Plattform
- automatische Kopie bestehender alter Default-Datenbanken ohne Nutzerentscheidung

Risiken:

- falsche Pfadauflosung auf Plattformen ohne erwartete Env-Variablen
- Tests, die den alten relativen DB-Default implizit erwarten
- Verwechslung zwischen fachlichem Workspace und technischem `workspaceRoot`
- zu aggressive Guards koennen bestehende lokale Repo-Workflows blockieren, wenn der Escape-Hatch nicht bewusst gestaltet wird
- eine unsaubere Vermischung von read-only Default-Config und mutablem User-Override fuehrt spaeter wieder zu update-unsicherem Zustand
- eine unklare Abgrenzung zwischen engine-globaler Konfiguration, Workspace-Konfiguration und DB-basierten Workspace-Settings fuehrt zu schwer debuggbarem Verhalten

## 14. Umsetzungsreihenfolge

1. `resolveUserDataDir()` und `resolveDefaultDbPath()` einfuehren
2. Konfigurationsstrategie und Lade-Reihenfolge fuer Default-Dateien, User-Overrides und CLI-Pfade explizit machen
3. CLI-Default fuer `--db` umstellen
4. App-Context-/Workspace-Root-Aufloesung explizit machen und den riskanten `repoRoot`-Fallback entfernen oder absichern
5. Workspace-Guards gegen Installations-/Repo-Roots in `workspace:create`, `workspace:update-root` und Kontextaufloesung einfuehren
6. gezielte Tests fuer Defaultpfade, Konfigurationsquellen, Overrides und Guards ergaenzen
7. Doku fuer Update-/Persistenzmodell nachziehen
8. optional spaetere Migrationshilfe fuer alte relative Default-DBs ergaenzen

## 15. Erfolgskriterien

- eine neue Installation erzeugt ihre DB nicht mehr im aktuellen Arbeitsverzeichnis
- ein App-Update ueberschreibt keine DB und keine engine-globalen Laufzeitdaten
- projektbezogene Artefakte bleiben im jeweiligen Workspace erhalten
- bestehende explizite `--db`-basierte Setups funktionieren unveraendert
- das System erschwert oder verhindert Workspaces im Installationspfad
- die Runtime-Default-Konfiguration bleibt updatebar im Installationsbaum, ohne dass mutable User-Overrides dort abgelegt werden muessen
- Konfigurationsquellen sind klar getrennt:
  - Installations-Defaults
  - engine-globale User-Overrides
  - workspace-projektbezogene Konfiguration
  - explizite CLI-Overrides
