import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  currentColumn: text("current_column").notNull(),
  phaseStatus: text("phase_status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const concepts = sqliteTable("concepts", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  markdownArtifactId: text("markdown_artifact_id").notNull(),
  structuredArtifactId: text("structured_artifact_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id),
  code: text("code").notNull().unique(),
  conceptId: text("concept_id").notNull().references(() => concepts.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull(),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  stageRunId: text("stage_run_id").references(() => stageRuns.id),
  itemId: text("item_id").notNull().references(() => items.id),
  projectId: text("project_id").references(() => projects.id),
  kind: text("kind").notNull(),
  format: text("format").notNull(),
  path: text("path").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at").notNull()
});

export const userStories = sqliteTable("user_stories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  actor: text("actor").notNull(),
  goal: text("goal").notNull(),
  benefit: text("benefit").notNull(),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  sourceArtifactId: text("source_artifact_id").notNull().references(() => artifacts.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const acceptanceCriteria = sqliteTable("acceptance_criteria", {
  id: text("id").primaryKey(),
  storyId: text("story_id").notNull().references(() => userStories.id),
  code: text("code").notNull().unique(),
  text: text("text").notNull(),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const architecturePlans = sqliteTable("architecture_plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  version: integer("version").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  markdownArtifactId: text("markdown_artifact_id").notNull().references(() => artifacts.id),
  structuredArtifactId: text("structured_artifact_id").notNull().references(() => artifacts.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const stageRuns = sqliteTable("stage_runs", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id),
  projectId: text("project_id").references(() => projects.id),
  stageKey: text("stage_key").notNull(),
  status: text("status").notNull(),
  inputSnapshotJson: text("input_snapshot_json").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  skillsSnapshotJson: text("skills_snapshot_json").notNull(),
  outputSummaryJson: text("output_summary_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  stageRunId: text("stage_run_id").notNull().references(() => stageRuns.id),
  adapterKey: text("adapter_key").notNull(),
  status: text("status").notNull(),
  commandJson: text("command_json").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitCode: integer("exit_code").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const stageRunInputArtifacts = sqliteTable(
  "stage_run_input_artifacts",
  {
    stageRunId: text("stage_run_id").notNull().references(() => stageRuns.id),
    artifactId: text("artifact_id").notNull().references(() => artifacts.id)
  },
  (table) => [primaryKey({ columns: [table.stageRunId, table.artifactId] })]
);

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});
