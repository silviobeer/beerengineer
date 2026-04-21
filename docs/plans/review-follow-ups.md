# Review Follow-Ups

Zurueckgestellt nach kritischer Pruefung:

- DB-`CHECK`-Constraints fuer Enum-Spalten in SQLite
  Sinnvoll als Härtung, aber nicht der naechste Hebel gegen reale MVP-Laufzeitfehler.
- persistierte Retry-Verknuepfung zwischen altem und neuem `StageRun`
  Nuetzlich fuer spaetere Tooling-Sichten, aktuell aber kein Blocker fuer kontrollierte Retries.
- Injektion von `PromptResolver` und `ArtifactService`
  Verbessert Testbarkeit, ist im aktuellen MVP aber kein akuter Stabilitaetsmangel.

Diese Punkte sollten vor dem Ausbau auf `ImplementationPlan` und `Wave` erneut bewertet werden.

Aktuelle Tech Debt:

- `brainstorm` nutzt noch nicht denselben generischen `StageReviewLoopService`
  wie `requirements`, `architecture` und `planning`.
  Semantisch ist der Flow weitgehend angeglichen:
  - Rueckfragen bleiben beim Stage-LLM
  - Reviews halten den offenen Zustand nicht selbst
  - Promotion wird auf explizite Entscheidungen gegatet
  Technisch bleibt `brainstorm` aber ein eigener dialogischer Sonderpfad mit
  eigenem Review-/Backfill-Mechanismus.
  Das ist bewusst vorerst akzeptiert, aber noch keine vollstaendige
  Vereinheitlichung des Review-Prozesses von `brainstorm` bis `planning`.
