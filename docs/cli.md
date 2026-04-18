# CLI

Wichtige MVP-Kommandos:

```bash
npm run cli -- item:create --title "My Item" --description "..."
npm run cli -- brainstorm:start --item-id <itemId>
npm run cli -- concept:approve --concept-id <conceptId>
npm run cli -- project:import --item-id <itemId>
npm run cli -- requirements:start --item-id <itemId> --project-id <projectId>
npm run cli -- stories:approve --project-id <projectId>
npm run cli -- architecture:start --item-id <itemId> --project-id <projectId>
npm run cli -- architecture:approve --project-id <projectId>
```

Optional:

```bash
npm run cli -- item:show --item-id <itemId>
npm run cli -- runs:list --item-id <itemId>
npm run cli -- run:show --run-id <runId>
npm run cli -- run:retry --run-id <runId>
npm run cli -- artifacts:list --item-id <itemId>
npm run cli -- sessions:list --run-id <runId>
```

Fehler werden als JSON auf `stderr` mit `error.code` und `error.message` ausgegeben.
