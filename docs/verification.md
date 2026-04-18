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
- 23 gruene Tests
