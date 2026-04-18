# Verification

## Wave 1

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run db:migrate -- ./var/data/wave1-check.sqlite`

Ergebnis: erfolgreich. Die technische Basis fuer weitere Waves steht.

## MVP Abschluss

- `npm run build`
- `npm run lint`
- `npm test`

Ergebnis: erfolgreich.

Abgedeckt:

- 11 Testdateien
- 20 Tests
- Unit-, Integrations- und CLI-End-to-End-Abdeckung fuer den MVP-Happy-Path bis `Architecture`

## Stabilisierung

- Diagnose-Kommandos fuer Runs, Artefakte und Sessions
- strukturierte CLI-Fehlerausgaben mit Exit-Code `1`
- Retry-Pfad fuer `review_required` und `failed`
- idempotente Freigaben und Projektimporte
- `npm run build`
- `npm run lint`
- `npm test`

Ergebnis: erfolgreich.

Aktueller Stand:

- 11 Testdateien
- 25 gruene Tests

## Review-Runde

Umgesetzt:

- Adapter-Timeout und Signalbehandlung
- transaktionale Vor- und Nachbloecke rund um `StageRun`-Schreibvorgaenge
- echte Verknuepfung von Input-Artefakten fuer Downstream-Runs
- schlankere Query-Pfade fuer Existenz- und Latest-Lookups
- nachvollziehbare `review_required`-Ursachen in `stage_runs.error_message`
- CWD-unabhaengige Aufloesung von Prompt-/Skill-Pfaden

Zurueckgestellt:

- [Review Follow-Ups](review-follow-ups.md)
