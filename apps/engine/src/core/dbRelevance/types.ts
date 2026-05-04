export type DbRelevanceSignal = {
  kind: "path" | "import" | "sql"
  path: string
  reason: string
}

export type DbRelevanceDetection = {
  signals: DbRelevanceSignal[]
}

export type DbRelevanceStory = {
  id: string
  title?: string
  dbRelevant: boolean
  dbRelevanceOverride?: "not-db-relevant"
  dbRelevanceOverrideReason?: string
}
