Inside `output`, return exactly these fields:
{ "storyCode": string, "overallStatus": "passed"|"review_required"|"failed", "summary": string, "acceptanceCriteriaResults": Array<{ "acceptanceCriterionId": string, "acceptanceCriterionCode": string, "status": "passed"|"review_required"|"failed", "evidence": string, "notes": string }>, "blockers": string[] }
