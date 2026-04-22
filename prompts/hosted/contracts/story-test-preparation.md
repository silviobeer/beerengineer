Inside `output`, return exactly these fields:
{ "summary": string, "testFiles": Array<{ "path": string, "content": string, "writeMode": "proposed"|"written" }>, "testsGenerated": Array<{ "path": string, "intent": string }>, "assumptions": string[], "blockers": string[] }
`testFiles` and `testsGenerated` are required and must be non-empty when the run succeeds.
