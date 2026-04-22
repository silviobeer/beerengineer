Inside `output`, return exactly these fields:
{ "assistantMessage": string, "plan": { "version": 1, "workspaceKey": string, "rootPath": string|null, "mode": "greenfield"|"brownfield", "stack": "node-ts", "scaffoldProjectFiles": boolean, "createRoot": boolean, "initGit": boolean, "installDeps": boolean, "withSonar": boolean, "withCoderabbit": boolean, "generatedAt": number }, "rationale": string[], "warnings": string[], "needsUserInput": boolean, "followUpHint": string|null }
Keep the response planning-only. Do not ask to execute commands directly.
Prefer preserving existing brownfield projects over scaffolding new starter files.
