# CodeRabbit Review Instructions

Projektkontext fuer Reviews:

- Dieses Repo ist engine-first. Keine UI-Erweiterungen vorschlagen, wenn sie nicht explizit angefordert sind.
- Bevorzuge klare Modulgrenzen zwischen `domain`, `workflow`, `persistence`, `services`, `adapters` und `cli`.
- Priorisiere in Reviews:
  - Status- und Gate-Logik
  - Reproduzierbarkeit von Runs
  - Artefakt- und Importpfade
  - Prompt- und Skill-Snapshots
  - transaktionale und persistente Konsistenz
- Kritisiere Scope-Erweiterungen, die ueber den dokumentierten MVP hinausgehen.
- Wenn du Findings meldest, priorisiere Bugs, Regressionsrisiken, fehlende Tests und inkonsistente Doku vor Stilfragen.
- Beruecksichtige die Repo-Regeln in [AGENTS.md](AGENTS.md) und [.codex/working-rules.md](.codex/working-rules.md).

Praktische Hinweise:

- Relevante Doku liegt unter `docs/`.
- Die verbindlichen Planquellen sind `modularer-agent-workflow-plan.md` und `mvp-wave-plan.md`.
- Fuer Review-Kontext ist der bevorzugte Aufruf:

```bash
coderabbit review --config coderabbit.md
```
