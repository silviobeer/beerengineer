# Testing Strategy

Die Tests werden pro Wave mitentwickelt. Fuer den MVP gilt folgende Testpyramide:

- Unit-Tests fuer Statusregeln, Validierung, Mapper und Resolver
- Integrations-Tests fuer Persistenz, Transaktionen und Import-Flows
- wenige CLI-End-to-End-Tests fuer den fachlichen Happy Path

## Wave 1

Wave 1 deckt die technische Basis ab:

- Test-Runner startet und fuehrt mindestens einen Smoke-Test aus
- Datenbankinitialisierung liefert eine nutzbare Verbindung
- Migrationen koennen gegen eine leere SQLite-Datei angewendet werden
- Fixture-Dateien lassen sich fuer Tests reproduzierbar laden

## Lokale Ausfuehrung

```bash
npm test
```

Gezielte Dateipruefung:

```bash
npm run db:check -- ./var/data/beerengineer.sqlite
```

Migration gegen eine Datei:

```bash
npm run db:migrate -- ./var/data/beerengineer.sqlite
```

## Testdaten

- JSON- und Markdown-Fixtures liegen unter `test/fixtures/`
- Integrations-Tests verwenden pro Lauf eine isolierte SQLite-Datei unter einem temporaeren Verzeichnis
- Gemeinsam genutzte Test-Helfer liegen unter `test/helpers/`
