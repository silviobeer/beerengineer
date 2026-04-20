import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  rootPath: text("root_path"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const workspaceSettings = sqliteTable("workspace_settings", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  defaultAdapterKey: text("default_adapter_key"),
  defaultModel: text("default_model"),
  autorunPolicyJson: text("autorun_policy_json"),
  promptOverridesJson: text("prompt_overrides_json"),
  skillOverridesJson: text("skill_overrides_json"),
  verificationDefaultsJson: text("verification_defaults_json"),
  appTestConfigJson: text("app_test_config_json"),
  qaDefaultsJson: text("qa_defaults_json"),
  gitDefaultsJson: text("git_defaults_json"),
  executionDefaultsJson: text("execution_defaults_json"),
  uiMetadataJson: text("ui_metadata_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const workspaceSonarSettings = sqliteTable("workspace_sonar_settings", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  enabled: integer("enabled").notNull(),
  providerType: text("provider_type").notNull(),
  hostUrl: text("host_url"),
  organization: text("organization"),
  projectKey: text("project_key"),
  token: text("token_ref"),
  defaultBranch: text("default_branch"),
  gatingMode: text("gating_mode").notNull(),
  validationStatus: text("validation_status").notNull(),
  lastTestedAt: integer("last_tested_at"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const workspaceCoderabbitSettings = sqliteTable("workspace_coderabbit_settings", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  enabled: integer("enabled").notNull(),
  providerType: text("provider_type").notNull(),
  hostUrl: text("host_url"),
  organization: text("organization"),
  repository: text("repository"),
  token: text("token_ref"),
  defaultBranch: text("default_branch"),
  gatingMode: text("gating_mode").notNull(),
  validationStatus: text("validation_status").notNull(),
  lastTestedAt: integer("last_tested_at"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  code: text("code").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  currentColumn: text("current_column").notNull(),
  phaseStatus: text("phase_status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => [uniqueIndex("items_workspace_code_unique_idx").on(table.workspaceId, table.code)]);

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

export const implementationPlans = sqliteTable("implementation_plans", {
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

export const waves = sqliteTable("waves", {
  id: text("id").primaryKey(),
  implementationPlanId: text("implementation_plan_id").notNull().references(() => implementationPlans.id),
  code: text("code").notNull(),
  goal: text("goal").notNull(),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const waveStories = sqliteTable("wave_stories", {
  id: text("id").primaryKey(),
  waveId: text("wave_id").notNull().references(() => waves.id),
  storyId: text("story_id").notNull().references(() => userStories.id).unique(),
  parallelGroup: text("parallel_group"),
  position: integer("position").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const waveStoryDependencies = sqliteTable(
  "wave_story_dependencies",
  {
    blockingStoryId: text("blocking_story_id").notNull().references(() => userStories.id),
    dependentStoryId: text("dependent_story_id").notNull().references(() => userStories.id)
  },
  (table) => [primaryKey({ columns: [table.blockingStoryId, table.dependentStoryId] })]
);

export const projectExecutionContexts = sqliteTable("project_execution_contexts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().unique().references(() => projects.id),
  relevantDirectoriesJson: text("relevant_directories_json").notNull(),
  relevantFilesJson: text("relevant_files_json").notNull(),
  integrationPointsJson: text("integration_points_json").notNull(),
  testLocationsJson: text("test_locations_json").notNull(),
  repoConventionsJson: text("repo_conventions_json").notNull(),
  executionNotesJson: text("execution_notes_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const waveExecutions = sqliteTable("wave_executions", {
  id: text("id").primaryKey(),
  waveId: text("wave_id").notNull().references(() => waves.id),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const waveStoryTestRuns = sqliteTable("wave_story_test_runs", {
  id: text("id").primaryKey(),
  waveExecutionId: text("wave_execution_id").notNull().references(() => waveExecutions.id),
  waveStoryId: text("wave_story_id").notNull().references(() => waveStories.id),
  storyId: text("story_id").notNull().references(() => userStories.id),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull(),
  workerRole: text("worker_role").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  skillsSnapshotJson: text("skills_snapshot_json").notNull(),
  businessContextSnapshotJson: text("business_context_snapshot_json").notNull(),
  repoContextSnapshotJson: text("repo_context_snapshot_json").notNull(),
  outputSummaryJson: text("output_summary_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const waveStoryExecutions = sqliteTable("wave_story_executions", {
  id: text("id").primaryKey(),
  waveExecutionId: text("wave_execution_id").notNull().references(() => waveExecutions.id),
  testPreparationRunId: text("test_preparation_run_id").notNull().references(() => waveStoryTestRuns.id),
  waveStoryId: text("wave_story_id").notNull().references(() => waveStories.id),
  storyId: text("story_id").notNull().references(() => userStories.id),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull(),
  workerRole: text("worker_role").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  skillsSnapshotJson: text("skills_snapshot_json").notNull(),
  businessContextSnapshotJson: text("business_context_snapshot_json").notNull(),
  repoContextSnapshotJson: text("repo_context_snapshot_json").notNull(),
  gitBranchName: text("git_branch_name"),
  gitBaseRef: text("git_base_ref"),
  gitMetadataJson: text("git_metadata_json"),
  outputSummaryJson: text("output_summary_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const testAgentSessions = sqliteTable("test_agent_sessions", {
  id: text("id").primaryKey(),
  waveStoryTestRunId: text("wave_story_test_run_id").notNull().references(() => waveStoryTestRuns.id),
  adapterKey: text("adapter_key").notNull(),
  status: text("status").notNull(),
  commandJson: text("command_json").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitCode: integer("exit_code").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const executionAgentSessions = sqliteTable("execution_agent_sessions", {
  id: text("id").primaryKey(),
  waveStoryExecutionId: text("wave_story_execution_id").notNull().references(() => waveStoryExecutions.id),
  adapterKey: text("adapter_key").notNull(),
  status: text("status").notNull(),
  commandJson: text("command_json").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitCode: integer("exit_code").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const verificationRuns = sqliteTable("verification_runs", {
  id: text("id").primaryKey(),
  waveExecutionId: text("wave_execution_id").references(() => waveExecutions.id),
  waveStoryExecutionId: text("wave_story_execution_id").references(() => waveStoryExecutions.id),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot"),
  skillsSnapshotJson: text("skills_snapshot_json"),
  summaryJson: text("summary_json").notNull(),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const appVerificationRuns = sqliteTable("app_verification_runs", {
  id: text("id").primaryKey(),
  waveStoryExecutionId: text("wave_story_execution_id").notNull().references(() => waveStoryExecutions.id),
  status: text("status").notNull(),
  runner: text("runner").notNull(),
  attempt: integer("attempt").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  projectAppTestContextJson: text("project_app_test_context_json"),
  storyContextJson: text("story_context_json"),
  preparedSessionJson: text("prepared_session_json"),
  resultJson: text("result_json"),
  artifactsJson: text("artifacts_json"),
  failureSummary: text("failure_summary"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const storyReviewRuns = sqliteTable("story_review_runs", {
  id: text("id").primaryKey(),
  waveStoryExecutionId: text("wave_story_execution_id").notNull().references(() => waveStoryExecutions.id),
  status: text("status").notNull(),
  inputSnapshotJson: text("input_snapshot_json").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  skillsSnapshotJson: text("skills_snapshot_json").notNull(),
  summaryJson: text("summary_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const storyReviewFindings = sqliteTable("story_review_findings", {
  id: text("id").primaryKey(),
  storyReviewRunId: text("story_review_run_id").notNull().references(() => storyReviewRuns.id),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  evidence: text("evidence").notNull(),
  filePath: text("file_path"),
  line: integer("line"),
  suggestedFix: text("suggested_fix"),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const storyReviewRemediationRuns = sqliteTable("story_review_remediation_runs", {
  id: text("id").primaryKey(),
  storyReviewRunId: text("story_review_run_id").notNull().references(() => storyReviewRuns.id),
  waveStoryExecutionId: text("wave_story_execution_id").notNull().references(() => waveStoryExecutions.id),
  remediationWaveStoryExecutionId: text("remediation_wave_story_execution_id").references(() => waveStoryExecutions.id),
  storyId: text("story_id").notNull().references(() => userStories.id),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull(),
  workerRole: text("worker_role").notNull(),
  inputSnapshotJson: text("input_snapshot_json").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  skillsSnapshotJson: text("skills_snapshot_json").notNull(),
  gitBranchName: text("git_branch_name"),
  gitBaseRef: text("git_base_ref"),
  gitMetadataJson: text("git_metadata_json"),
  outputSummaryJson: text("output_summary_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const storyReviewRemediationFindings = sqliteTable(
  "story_review_remediation_findings",
  {
    storyReviewRemediationRunId: text("story_review_remediation_run_id")
      .notNull()
      .references(() => storyReviewRemediationRuns.id),
    storyReviewFindingId: text("story_review_finding_id").notNull().references(() => storyReviewFindings.id),
    resolutionStatus: text("resolution_status").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.storyReviewRemediationRunId, table.storyReviewFindingId] })]
);

export const storyReviewRemediationAgentSessions = sqliteTable("story_review_remediation_agent_sessions", {
  id: text("id").primaryKey(),
  storyReviewRemediationRunId: text("story_review_remediation_run_id")
    .notNull()
    .references(() => storyReviewRemediationRuns.id),
  adapterKey: text("adapter_key").notNull(),
  status: text("status").notNull(),
  commandJson: text("command_json").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitCode: integer("exit_code").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const storyReviewAgentSessions = sqliteTable("story_review_agent_sessions", {
  id: text("id").primaryKey(),
  storyReviewRunId: text("story_review_run_id").notNull().references(() => storyReviewRuns.id),
  adapterKey: text("adapter_key").notNull(),
  status: text("status").notNull(),
  commandJson: text("command_json").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitCode: integer("exit_code").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const qaRuns = sqliteTable("qa_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  inputSnapshotJson: text("input_snapshot_json").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  skillsSnapshotJson: text("skills_snapshot_json").notNull(),
  summaryJson: text("summary_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const qaFindings = sqliteTable("qa_findings", {
  id: text("id").primaryKey(),
  qaRunId: text("qa_run_id").notNull().references(() => qaRuns.id),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  evidence: text("evidence").notNull(),
  reproStepsJson: text("repro_steps_json").notNull(),
  suggestedFix: text("suggested_fix"),
  status: text("status").notNull(),
  storyId: text("story_id").references(() => userStories.id),
  acceptanceCriterionId: text("acceptance_criterion_id").references(() => acceptanceCriteria.id),
  waveStoryExecutionId: text("wave_story_execution_id").references(() => waveStoryExecutions.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const qaAgentSessions = sqliteTable("qa_agent_sessions", {
  id: text("id").primaryKey(),
  qaRunId: text("qa_run_id").notNull().references(() => qaRuns.id),
  adapterKey: text("adapter_key").notNull(),
  status: text("status").notNull(),
  commandJson: text("command_json").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitCode: integer("exit_code").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const qualityKnowledgeEntries = sqliteTable("quality_knowledge_entries", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  projectId: text("project_id").references(() => projects.id),
  waveId: text("wave_id").references(() => waves.id),
  storyId: text("story_id").references(() => userStories.id),
  source: text("source").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id").notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  status: text("status").notNull(),
  relevanceTagsJson: text("relevance_tags_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => [
  uniqueIndex("quality_knowledge_entries_workspace_scope_summary_unique_idx").on(
    table.workspaceId,
    table.source,
    table.scopeType,
    table.scopeId,
    table.kind,
    table.summary
  )
]);

export const documentationRuns = sqliteTable("documentation_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  status: text("status").notNull(),
  inputSnapshotJson: text("input_snapshot_json").notNull(),
  systemPromptSnapshot: text("system_prompt_snapshot").notNull(),
  skillsSnapshotJson: text("skills_snapshot_json").notNull(),
  staleAt: integer("stale_at"),
  staleReason: text("stale_reason"),
  summaryJson: text("summary_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at")
});

export const documentationAgentSessions = sqliteTable("documentation_agent_sessions", {
  id: text("id").primaryKey(),
  documentationRunId: text("documentation_run_id").notNull().references(() => documentationRuns.id),
  adapterKey: text("adapter_key").notNull(),
  status: text("status").notNull(),
  commandJson: text("command_json").notNull(),
  stdout: text("stdout").notNull(),
  stderr: text("stderr").notNull(),
  exitCode: integer("exit_code").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const interactiveReviewSessions = sqliteTable("interactive_review_sessions", {
  id: text("id").primaryKey(),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id").notNull(),
  artifactType: text("artifact_type").notNull(),
  reviewType: text("review_type").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  resolvedAt: integer("resolved_at"),
  lastAssistantMessageId: text("last_assistant_message_id"),
  lastUserMessageId: text("last_user_message_id")
});

export const interactiveReviewMessages = sqliteTable("interactive_review_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => interactiveReviewSessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  structuredPayloadJson: text("structured_payload_json"),
  derivedUpdatesJson: text("derived_updates_json"),
  createdAt: integer("created_at").notNull()
});

export const interactiveReviewEntries = sqliteTable("interactive_review_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => interactiveReviewSessions.id),
  entryType: text("entry_type").notNull(),
  entryId: text("entry_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  changeRequest: text("change_request"),
  rationale: text("rationale"),
  severity: text("severity"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => [uniqueIndex("interactive_review_entry_unique_idx").on(table.sessionId, table.entryType, table.entryId)]);

export const interactiveReviewResolutions = sqliteTable("interactive_review_resolutions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => interactiveReviewSessions.id),
  resolutionType: text("resolution_type").notNull(),
  payloadJson: text("payload_json"),
  createdAt: integer("created_at").notNull(),
  appliedAt: integer("applied_at")
});

export const brainstormSessions = sqliteTable("brainstorm_sessions", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id),
  status: text("status").notNull(),
  mode: text("mode").notNull(),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  resolvedAt: integer("resolved_at"),
  lastAssistantMessageId: text("last_assistant_message_id"),
  lastUserMessageId: text("last_user_message_id")
});

export const brainstormMessages = sqliteTable("brainstorm_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => brainstormSessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  structuredPayloadJson: text("structured_payload_json"),
  derivedUpdatesJson: text("derived_updates_json")
});

export const brainstormDrafts = sqliteTable("brainstorm_drafts", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id),
  sessionId: text("session_id").notNull().references(() => brainstormSessions.id),
  revision: integer("revision").notNull(),
  status: text("status").notNull(),
  problem: text("problem"),
  targetUsersJson: text("target_users_json").notNull(),
  coreOutcome: text("core_outcome"),
  useCasesJson: text("use_cases_json").notNull(),
  constraintsJson: text("constraints_json").notNull(),
  nonGoalsJson: text("non_goals_json").notNull(),
  risksJson: text("risks_json").notNull(),
  openQuestionsJson: text("open_questions_json").notNull(),
  candidateDirectionsJson: text("candidate_directions_json").notNull(),
  recommendedDirection: text("recommended_direction"),
  scopeNotes: text("scope_notes"),
  assumptionsJson: text("assumptions_json").notNull(),
  lastUpdatedAt: integer("last_updated_at").notNull(),
  lastUpdatedFromMessageId: text("last_updated_from_message_id")
}, (table) => [uniqueIndex("brainstorm_drafts_session_revision_unique_idx").on(table.sessionId, table.revision)]);

export const workspaceAssistSessions = sqliteTable("workspace_assist_sessions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  status: text("status").notNull(),
  currentPlanJson: text("current_plan_json").notNull(),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  resolvedAt: integer("resolved_at"),
  lastAssistantMessageId: text("last_assistant_message_id"),
  lastUserMessageId: text("last_user_message_id")
});

export const workspaceAssistMessages = sqliteTable("workspace_assist_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => workspaceAssistSessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  structuredPayloadJson: text("structured_payload_json"),
  derivedPlanJson: text("derived_plan_json"),
  createdAt: integer("created_at").notNull()
});

export const planningReviewRuns = sqliteTable("planning_review_runs", {
  id: text("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  step: text("step").notNull(),
  status: text("status").notNull(),
  interactionMode: text("interaction_mode").notNull(),
  reviewMode: text("review_mode").notNull(),
  automationLevel: text("automation_level").notNull(),
  requestedMode: text("requested_mode").notNull(),
  actualMode: text("actual_mode").notNull(),
  readiness: text("readiness"),
  confidence: text("confidence").notNull(),
  gateEligibility: text("gate_eligibility").notNull(),
  normalizedArtifactJson: text("normalized_artifact_json").notNull(),
  providersUsedJson: text("providers_used_json").notNull(),
  missingCapabilitiesJson: text("missing_capabilities_json").notNull(),
  reviewSummary: text("review_summary"),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
  failedReason: text("failed_reason")
}, (table) => [
  uniqueIndex("planning_review_runs_source_started_unique_idx").on(table.sourceType, table.sourceId, table.startedAt)
]);

export const planningReviewFindings = sqliteTable("planning_review_findings", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => planningReviewRuns.id),
  reviewerRole: text("reviewer_role").notNull(),
  findingType: text("finding_type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  evidence: text("evidence"),
  status: text("status").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
}, (table) => [uniqueIndex("planning_review_findings_run_fingerprint_unique_idx").on(table.runId, table.fingerprint)]);

export const planningReviewSyntheses = sqliteTable("planning_review_syntheses", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => planningReviewRuns.id),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  readiness: text("readiness").notNull(),
  keyPointsJson: text("key_points_json").notNull(),
  disagreementsJson: text("disagreements_json").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  createdAt: integer("created_at").notNull()
});

export const planningReviewQuestions = sqliteTable("planning_review_questions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => planningReviewRuns.id),
  question: text("question").notNull(),
  reason: text("reason").notNull(),
  impact: text("impact").notNull(),
  status: text("status").notNull(),
  answer: text("answer"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  answeredAt: integer("answered_at")
});

export const planningReviewAssumptions = sqliteTable("planning_review_assumptions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => planningReviewRuns.id),
  statement: text("statement").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull(),
  createdAt: integer("created_at").notNull()
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
