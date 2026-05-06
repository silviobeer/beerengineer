# PROJ-5-PRD-2: Interactive Setup Entry

## Status: Planned

## User Stories

### US-1: Als nontechnical User moechte ich mit `beerengineer setup` direkt in die Setup-UI gelangen um ohne Terminalwissen starten zu koennen
**Given** beerengineer_ ist installiert und ich starte `beerengineer setup` interaktiv
**When** Setup laeuft
**Then** beerengineer_ erstellt oder verwendet App-Config und SQLite-DB
**And** es startet oder verwendet Engine und UI
**And** es oeffnet die Setup-URL im Browser, wenn ein Opener verfuegbar ist

**Acceptance Criteria:**
- [ ] AC-1: Interaktives `beerengineer setup` initialisiert fehlende App-Config und DB wie bisher.
- [ ] AC-2: Interaktives `beerengineer setup` startet oder verwendet eine laufende Engine.
- [ ] AC-3: Interaktives `beerengineer setup` startet oder verwendet eine laufende UI.
- [ ] AC-4: Die geoeffnete URL wird aus Runtime/Config ermittelt und nicht hartcodiert.
- [ ] AC-5: Erfolgreicher Browser-Open wird mit der verwendeten URL gemeldet.

### US-2: Als Developer in SSH, CI oder Container moechte ich Setup ohne Browser-Fehler nutzen um die echte Setup-URL manuell oeffnen zu koennen
**Given** ich starte `beerengineer setup` in einer Umgebung ohne funktionierenden Browser-Opener
**When** Engine und UI verfuegbar gemacht wurden
**Then** beerengineer_ druckt die entdeckte Setup-URL
**And** Setup scheitert nicht nur deshalb, weil kein Browser geoeffnet werden kann

**Acceptance Criteria:**
- [ ] AC-6: Headless-, CI-, SSH-, Container- oder No-Opener-Situationen degradieren zu "URL drucken".
- [ ] AC-7: Die gedruckte URL ist die tatsaechlich entdeckte URL inklusive Host und Port.
- [ ] AC-8: Engine und UI bleiben verfuegbar, wenn sie erfolgreich gestartet oder gefunden wurden.
- [ ] AC-9: Browser-Open-Fehler wird als recoverable Setup-Hinweis gemeldet, nicht als harter Core-Fehler.

### US-3: Als Automation oder Install-Validator moechte ich `setup --no-interactive` ohne UI-Start verwenden um reproduzierbare Checks zu erhalten
**Given** ein Script, Test oder Agent startet `beerengineer setup --no-interactive`
**When** Setup laeuft
**Then** beerengineer_ provisioniert Config und DB ohne Browser-Open
**And** es meldet Git-Identity-Readiness strukturiert und ohne interaktive Prompts

**Acceptance Criteria:**
- [ ] AC-10: `setup --no-interactive` versucht keinen Browser-Open.
- [ ] AC-11: `setup --no-interactive` startet keine interaktive Eingabe fuer Git-Identitaet.
- [ ] AC-12: `setup --no-interactive` kann fehlende Git-Identitaet als actionable readiness melden.
- [ ] AC-13: `setup --no-interactive` bleibt fuer bestehende Install- und Doctor-Tests deterministisch.

### US-4: Als CLI User moechte ich App-Level-Git-Identitaet im Terminal speichern koennen um den Engine-first Setup-Pfad vollstaendig zu nutzen
**Given** ich verwende interaktives CLI-Setup
**When** beerengineer_ erkennt, dass keine App-Level-Default-Identitaet existiert oder ich sie bearbeiten will
**Then** das CLI kann Display Name und Email abfragen und speichern
**And** dieselbe Validierung und Speicherung wie UI/API verwenden

**Acceptance Criteria:**
- [ ] AC-14: Interaktives CLI-Setup bietet eine Eingabe fuer App-Level-Default-Name und Email.
- [ ] AC-15: CLI-Validierungsfehler sind feldspezifisch und erklaeren die Korrektur.
- [ ] AC-16: Eine gespeicherte CLI-Identitaet erscheint danach im Setup-Readiness-Status.
- [ ] AC-17: CLI-Setup schreibt keine globale Git-Konfiguration.
- [ ] AC-18: CLI-Setup kann aus globaler Git-Identitaet vorbefuellen und trotzdem Edit/Skip erlauben.

## Edge Cases

- Was passiert, wenn die Engine schon auf dem konfigurierten Port laeuft?
- Was passiert, wenn der UI-Port belegt ist und ein anderer Port verwendet wird?
- Was passiert, wenn Engine startet, aber UI-Start fehlschlaegt?
- Was passiert, wenn kein TTY vorhanden ist, aber `--no-interactive` nicht gesetzt wurde?
- Was passiert, wenn Browser-Open blockiert wird, aber die UI erreichbar ist?

## Abhaengigkeiten

- Benoetigt: PROJ-5-PRD-1 fuer Git-Identity-Status, Validierung und App-Level-Default-Speicherung.
- Wird von PROJ-5-PRD-3 genutzt, weil `beerengineer setup` die vorhandene Setup-UI oeffnet.

## Technische Anforderungen

- Setup-URL muss aus tatsaechlichem Runtime-/Config-Zustand ermittelt werden.
- Interaktive Browser-Open-Fehler sind recoverable, solange CLI eine nutzbare URL ausgeben kann.
- `--no-interactive` bleibt browserfrei und promptfrei.

