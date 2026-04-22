The final JSON object must use this exact top-level shape:
{ "markdownArtifacts": Array<{ "kind": string, "content": string }>, "structuredArtifacts": Array<{ "kind": string, "content": unknown }>, "needsUserInput"?: boolean, "userInputQuestion"?: string|null, "followUpHint"?: string|null }
When the stage can not proceed safely without a user clarification, return empty artifact arrays, set `needsUserInput` to true, and provide `userInputQuestion`.
