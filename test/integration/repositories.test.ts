import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/persistence/database.js";
import { applyMigrations } from "../../src/persistence/migrator.js";
import { baseMigrations } from "../../src/persistence/migration-registry.js";
import { resolveWorkspaceBrowserUrl } from "../../src/shared/workspace-browser-url.js";
import {
  AcceptanceCriterionRepository,
  AppVerificationRunRepository,
  ArtifactRepository,
  ArchitecturePlanRepository,
  ConceptRepository,
  DocumentationAgentSessionRepository,
  DocumentationRunRepository,
  ExecutionAgentSessionRepository,
  ImplementationPlanRepository,
  InteractiveReviewEntryRepository,
  InteractiveReviewMessageRepository,
  InteractiveReviewResolutionRepository,
  InteractiveReviewSessionRepository,
  ItemRepository,
  QualityKnowledgeEntryRepository,
  QaAgentSessionRepository,
  QaFindingRepository,
  QaRunRepository,
  ProjectExecutionContextRepository,
  ProjectRepository,
  StoryReviewAgentSessionRepository,
  StoryReviewFindingRepository,
  StoryReviewRemediationAgentSessionRepository,
  StoryReviewRemediationFindingRepository,
  StoryReviewRemediationRunRepository,
  StoryReviewRunRepository,
  TestAgentSessionRepository,
  UserStoryRepository,
  VerificationRunRepository,
  WorkspaceRepository,
  WorkspaceCoderabbitSettingsRepository,
  WorkspaceSettingsRepository,
  WorkspaceSonarSettingsRepository,
  WaveRepository,
  WaveExecutionRepository,
  WaveStoryTestRunRepository,
  WaveStoryDependencyRepository,
  WaveStoryExecutionRepository,
  WaveStoryRepository
} from "../../src/persistence/repositories.js";

const defaultBrowserUrl = resolveWorkspaceBrowserUrl("default");
import { createTestDatabase } from "../helpers/database.js";

describe("repositories", () => {
  it("supports item, concept and project CRUD", () => {
    const testDb = createTestDatabase();
    const db = createDatabase(testDb.filePath).db;
    const itemRepository = new ItemRepository(db);
    const workspaceRepository = new WorkspaceRepository(db);
    const workspaceSettingsRepository = new WorkspaceSettingsRepository(db);
    const workspaceSonarSettingsRepository = new WorkspaceSonarSettingsRepository(db);
    const workspaceCoderabbitSettingsRepository = new WorkspaceCoderabbitSettingsRepository(db);
    const conceptRepository = new ConceptRepository(db);
    const projectRepository = new ProjectRepository(db);
    const userStoryRepository = new UserStoryRepository(db);
    const acceptanceCriterionRepository = new AcceptanceCriterionRepository(db);
    const architecturePlanRepository = new ArchitecturePlanRepository(db);
    const implementationPlanRepository = new ImplementationPlanRepository(db);
    const waveRepository = new WaveRepository(db);
    const waveStoryRepository = new WaveStoryRepository(db);
    const waveStoryDependencyRepository = new WaveStoryDependencyRepository(db);
    const projectExecutionContextRepository = new ProjectExecutionContextRepository(db);
    const waveExecutionRepository = new WaveExecutionRepository(db);
    const waveStoryTestRunRepository = new WaveStoryTestRunRepository(db);
    const testAgentSessionRepository = new TestAgentSessionRepository(db);
    const waveStoryExecutionRepository = new WaveStoryExecutionRepository(db);
    const executionAgentSessionRepository = new ExecutionAgentSessionRepository(db);
    const verificationRunRepository = new VerificationRunRepository(db);
    const appVerificationRunRepository = new AppVerificationRunRepository(db);
    const storyReviewRunRepository = new StoryReviewRunRepository(db);
    const storyReviewFindingRepository = new StoryReviewFindingRepository(db);
    const storyReviewAgentSessionRepository = new StoryReviewAgentSessionRepository(db);
    const storyReviewRemediationRunRepository = new StoryReviewRemediationRunRepository(db);
    const storyReviewRemediationFindingRepository = new StoryReviewRemediationFindingRepository(db);
    const storyReviewRemediationAgentSessionRepository = new StoryReviewRemediationAgentSessionRepository(db);
    const qaRunRepository = new QaRunRepository(db);
    const qaFindingRepository = new QaFindingRepository(db);
    const qaAgentSessionRepository = new QaAgentSessionRepository(db);
    const qualityKnowledgeEntryRepository = new QualityKnowledgeEntryRepository(db);
    const documentationRunRepository = new DocumentationRunRepository(db);
    const documentationAgentSessionRepository = new DocumentationAgentSessionRepository(db);
    const interactiveReviewSessionRepository = new InteractiveReviewSessionRepository(db);
    const interactiveReviewMessageRepository = new InteractiveReviewMessageRepository(db);
    const interactiveReviewEntryRepository = new InteractiveReviewEntryRepository(db);
    const interactiveReviewResolutionRepository = new InteractiveReviewResolutionRepository(db);
    const artifactRepository = new ArtifactRepository(db);

    try {
      const defaultWorkspace = workspaceRepository.getByKey("default");
      const item = itemRepository.create({ workspaceId: defaultWorkspace!.id, title: "Item", description: "Desc" });
      const concept = conceptRepository.create({
        itemId: item.id,
        version: 1,
        title: "Concept",
        summary: "Summary",
        status: "draft",
        markdownArtifactId: "artifact_md",
        structuredArtifactId: "artifact_json"
      });
      const projects = projectRepository.createMany([
        {
          itemId: item.id,
          code: `${item.code}-P01`,
          conceptId: concept.id,
          title: "Project",
          summary: "Summary",
          goal: "Goal",
          status: "draft",
          position: 0
        }
      ]);

      expect(itemRepository.getById(item.id)?.title).toBe("Item");
      expect(itemRepository.getById(item.id)?.code).toBe("ITEM-0001");
      expect(itemRepository.getById(item.id)?.workspaceId).toBe(defaultWorkspace?.id);
      expect(workspaceSettingsRepository.getByWorkspaceId(defaultWorkspace!.id)?.workspaceId).toBe(defaultWorkspace?.id);
      const sonarSettings = workspaceSonarSettingsRepository.upsertByWorkspaceId({
        workspaceId: defaultWorkspace!.id,
        enabled: 1,
        providerType: "sonarcloud",
        hostUrl: "https://sonarcloud.io",
        organization: "acme",
        projectKey: "acme_beerengineer",
        token: "secret-sonar-token",
        defaultBranch: "main",
        gatingMode: "story_gate",
        validationStatus: "valid",
        lastError: null,
        lastTestedAt: 123
      });
      const coderabbitSettings = workspaceCoderabbitSettingsRepository.upsertByWorkspaceId({
        workspaceId: defaultWorkspace!.id,
        enabled: 1,
        providerType: "coderabbit",
        hostUrl: "https://api.coderabbit.ai",
        organization: "acme",
        repository: "beerengineer",
        token: "secret-coderabbit-token",
        defaultBranch: "main",
        gatingMode: "advisory",
        validationStatus: "untested",
        lastError: null,
        lastTestedAt: null
      });
      expect(sonarSettings.validationStatus).toBe("valid");
      expect(workspaceSonarSettingsRepository.isConfigured(defaultWorkspace!.id)).toBe(true);
      expect(coderabbitSettings.repository).toBe("beerengineer");
      expect(workspaceCoderabbitSettingsRepository.isConfigured(defaultWorkspace!.id)).toBe(true);
      expect(conceptRepository.getLatestByItemId(item.id)?.id).toBe(concept.id);
      expect(projects[0]?.code).toBe("ITEM-0001-P01");
      expect(projects).toHaveLength(1);
      const sourceArtifact = artifactRepository.create({
        stageRunId: null,
        itemId: item.id,
        projectId: projects[0]!.id,
        kind: "stories",
        format: "json",
        path: "items/test/stories.json",
        sha256: "def",
        sizeBytes: 24
      });
      const stories = userStoryRepository.createMany([
        {
          projectId: projects[0]!.id,
          code: "ITEM-0001-P01-US01",
          title: "Story",
          description: "Description",
          actor: "operator",
          goal: "Goal",
          benefit: "Benefit",
          priority: "high",
          status: "draft",
          sourceArtifactId: sourceArtifact.id
        },
        {
          projectId: projects[0]!.id,
          code: "ITEM-0001-P01-US02",
          title: "Story 2",
          description: "Description 2",
          actor: "operator",
          goal: "Goal 2",
          benefit: "Benefit 2",
          priority: "medium",
          status: "draft",
          sourceArtifactId: sourceArtifact.id
        }
      ]);
      const criteria = acceptanceCriterionRepository.createMany([
        {
          storyId: stories[0]!.id,
          code: "ITEM-0001-P01-US01-AC01",
          text: "Criterion",
          position: 0
        }
      ]);
      expect(criteria[0]?.code).toBe("ITEM-0001-P01-US01-AC01");

      const markdownArtifact = artifactRepository.create({
        stageRunId: null,
        itemId: item.id,
        projectId: projects[0]!.id,
        kind: "architecture-plan",
        format: "md",
        path: "items/test/architecture-plan.md",
        sha256: "ghi",
        sizeBytes: 24
      });
      const structuredArtifact = artifactRepository.create({
        stageRunId: null,
        itemId: item.id,
        projectId: projects[0]!.id,
        kind: "architecture-plan-data",
        format: "json",
        path: "items/test/architecture-plan-data.json",
        sha256: "jkl",
        sizeBytes: 24
      });
      const architecturePlan = architecturePlanRepository.create({
        projectId: projects[0]!.id,
        version: 1,
        summary: "Architecture Summary",
        status: "approved",
        markdownArtifactId: markdownArtifact.id,
        structuredArtifactId: structuredArtifact.id
      });
      const implementationMarkdown = artifactRepository.create({
        stageRunId: null,
        itemId: item.id,
        projectId: projects[0]!.id,
        kind: "implementation-plan",
        format: "md",
        path: "items/test/implementation-plan.md",
        sha256: "mno",
        sizeBytes: 24
      });
      const implementationStructured = artifactRepository.create({
        stageRunId: null,
        itemId: item.id,
        projectId: projects[0]!.id,
        kind: "implementation-plan-data",
        format: "json",
        path: "items/test/implementation-plan-data.json",
        sha256: "pqr",
        sizeBytes: 24
      });
      const implementationPlan = implementationPlanRepository.create({
        projectId: projects[0]!.id,
        version: 1,
        summary: "Implementation Summary",
        status: "draft",
        markdownArtifactId: implementationMarkdown.id,
        structuredArtifactId: implementationStructured.id
      });
      const createdWaves = waveRepository.createMany([
        {
          implementationPlanId: implementationPlan.id,
          code: "W01",
          goal: "Goal",
          position: 0
        }
      ]);
      const waveStories = waveStoryRepository.createMany([
        {
          waveId: createdWaves[0]!.id,
          storyId: stories[0]!.id,
          parallelGroup: null,
          position: 0
        }
      ]);
      const dependencies = waveStoryDependencyRepository.createMany([
        {
          blockingStoryId: stories[0]!.id,
          dependentStoryId: stories[1]!.id
        }
      ]);
      const projectExecutionContext = projectExecutionContextRepository.upsert({
        projectId: projects[0]!.id,
        relevantDirectories: ["src"],
        relevantFiles: ["README.md"],
        integrationPoints: ["workflow-service"],
        testLocations: ["test/integration"],
        repoConventions: ["engine-controlled execution"],
        executionNotes: ["created in repository test"]
      });
      const waveExecution = waveExecutionRepository.create({
        waveId: createdWaves[0]!.id,
        status: "running",
        attempt: 1
      });
      const waveStoryTestRun = waveStoryTestRunRepository.create({
        waveExecutionId: waveExecution.id,
        waveStoryId: waveStories[0]!.id,
        storyId: stories[0]!.id,
        status: "completed",
        attempt: 1,
        workerRole: "test-writer",
        systemPromptSnapshot: "test preparation prompt",
        skillsSnapshotJson: JSON.stringify([{ path: "skills/test-writer.md", content: "Test writer skill" }]),
        businessContextSnapshotJson: "{\"story\":\"ITEM-0001-P01-US01\"}",
        repoContextSnapshotJson: "{\"files\":[\"test/generated/item-0001-p01-us01.test.ts\"]}",
        outputSummaryJson: "{\"summary\":\"tests prepared\"}",
        errorMessage: null
      });
      const testSession = testAgentSessionRepository.create({
        waveStoryTestRunId: waveStoryTestRun.id,
        adapterKey: "local-cli",
        status: "completed",
        commandJson: "[\"node\"]",
        stdout: "{}",
        stderr: "",
        exitCode: 0
      });
      const waveStoryExecution = waveStoryExecutionRepository.create({
        waveExecutionId: waveExecution.id,
        testPreparationRunId: waveStoryTestRun.id,
        waveStoryId: waveStories[0]!.id,
        storyId: stories[0]!.id,
        status: "completed",
        attempt: 1,
        workerRole: "backend-implementer",
        systemPromptSnapshot: "execution prompt",
        skillsSnapshotJson: JSON.stringify([{ path: "skills/execution-implementer.md", content: "Execution skill" }]),
        businessContextSnapshotJson: "{\"story\":\"ITEM-0001-P01-US01\"}",
        repoContextSnapshotJson: "{\"files\":[\"src/workflow/workflow-service.ts\"]}",
        gitBranchName: "story/ITEM-0001-P01/ITEM-0001-P01-US01",
        gitBaseRef: "proj/ITEM-0001-P01",
        gitMetadataJson: "{\"strategy\":\"simulated\"}",
        outputSummaryJson: "{\"summary\":\"done\"}",
        errorMessage: null
      });
      const executionSession = executionAgentSessionRepository.create({
        waveStoryExecutionId: waveStoryExecution.id,
        adapterKey: "local-cli",
        status: "completed",
        commandJson: "[\"node\"]",
        stdout: "{}",
        stderr: "",
        exitCode: 0
      });
      const verificationRun = verificationRunRepository.create({
        waveExecutionId: waveExecution.id,
        waveStoryExecutionId: waveStoryExecution.id,
        mode: "basic",
        status: "passed",
        systemPromptSnapshot: null,
        skillsSnapshotJson: null,
        summaryJson: "{\"testsRun\":[{\"command\":\"npm test\",\"status\":\"passed\"}]}",
        errorMessage: null
      });
      const appVerificationRun = appVerificationRunRepository.create({
        waveStoryExecutionId: waveStoryExecution.id,
        status: "in_progress",
        runner: "agent_browser",
        attempt: 1,
        projectAppTestContextJson: JSON.stringify({ baseUrl: defaultBrowserUrl.baseUrl }),
        storyContextJson: "{\"storyCode\":\"ITEM-0001-P01-US01\"}",
        preparedSessionJson: "{\"ready\":true}",
        resultJson: null,
        artifactsJson: null,
        failureSummary: null
      });
      appVerificationRunRepository.updateStatus(appVerificationRun.id, "passed", {
        runner: "playwright",
        projectAppTestContextJson: JSON.stringify({ baseUrl: defaultBrowserUrl.baseUrl }),
        storyContextJson: "{\"storyCode\":\"ITEM-0001-P01-US01\"}",
        preparedSessionJson: "{\"ready\":true}",
        resultJson: "{\"overallStatus\":\"passed\"}",
        artifactsJson: "[]",
        failureSummary: null,
        startedAt: Date.now()
      });
      const qaRun = qaRunRepository.create({
        projectId: projects[0]!.id,
        mode: "full",
        status: "running",
        inputSnapshotJson: "{\"projectCode\":\"ITEM-0001-P01\"}",
        systemPromptSnapshot: "qa prompt",
        skillsSnapshotJson: JSON.stringify([{ path: "skills/qa-verifier.md", content: "QA skill" }]),
        summaryJson: null,
        errorMessage: null
      });
      const qaFindings = qaFindingRepository.createMany([
        {
          qaRunId: qaRun.id,
          severity: "medium",
          category: "functional",
          title: "Duplicate submission is possible",
          description: "Submitting twice quickly creates two records.",
          evidence: "Observed in assembled flow after story completion.",
          reproSteps: ["Open the relevant flow", "Submit twice quickly"],
          suggestedFix: "Add idempotent handling or disable repeated submission.",
          status: "open",
          storyId: stories[0]!.id,
          acceptanceCriterionId: criteria[0]!.id,
          waveStoryExecutionId: waveStoryExecution.id
        }
      ]);
      const qaSession = qaAgentSessionRepository.create({
        qaRunId: qaRun.id,
        adapterKey: "local-cli",
        status: "completed",
        commandJson: "[\"node\"]",
        stdout: "{}",
        stderr: "",
        exitCode: 0
      });
      qaRunRepository.updateStatus(qaRun.id, "review_required", {
        summaryJson: "{\"overallStatus\":\"review_required\"}"
      });
      const storyReviewRun = storyReviewRunRepository.create({
        waveStoryExecutionId: waveStoryExecution.id,
        status: "review_required",
        inputSnapshotJson: "{\"storyCode\":\"ITEM-0001-P01-US01\"}",
        systemPromptSnapshot: "story review prompt",
        skillsSnapshotJson: JSON.stringify([{ path: "skills/story-reviewer.md", content: "Story review skill" }]),
        summaryJson: "{\"overallStatus\":\"review_required\"}",
        errorMessage: "Potential persistence issue"
      });
      const storyReviewFindings = storyReviewFindingRepository.createMany([
        {
          storyReviewRunId: storyReviewRun.id,
          severity: "medium",
          category: "persistence",
          title: "Potential persistence issue",
          description: "The implementation may rely on an implicit persistence invariant.",
          evidence: "Observed in the repository access pattern for the completed story.",
          filePath: "src/persistence/repositories.ts",
          line: 123,
          suggestedFix: "Make the persistence assumption explicit with a guard or comment.",
          status: "open"
        }
      ]);
      const storyReviewSession = storyReviewAgentSessionRepository.create({
        storyReviewRunId: storyReviewRun.id,
        adapterKey: "local-cli",
        status: "completed",
        commandJson: "[\"node\"]",
        stdout: "{}",
        stderr: "",
        exitCode: 0
      });
      const qualityKnowledgeEntries = qualityKnowledgeEntryRepository.createMany([
        {
          workspaceId: defaultWorkspace!.id,
          projectId: projects[0]!.id,
          waveId: createdWaves[0]!.id,
          storyId: stories[0]!.id,
          source: "story_review",
          scopeType: "file",
          scopeId: "src/persistence/repositories.ts",
          kind: "recurring_issue",
          summary: "Repository persistence invariants need explicit guards",
          evidenceJson: "{\"severity\":\"medium\"}",
          status: "open",
          relevanceTagsJson:
            "{\"files\":[\"src/persistence/repositories.ts\"],\"storyCodes\":[\"ITEM-0001-P01-US01\"],\"modules\":[\"src/persistence\"],\"categories\":[\"persistence\"]}"
        }
      ]);
      const remediationRun = storyReviewRemediationRunRepository.create({
        storyReviewRunId: storyReviewRun.id,
        waveStoryExecutionId: waveStoryExecution.id,
        remediationWaveStoryExecutionId: waveStoryExecution.id,
        storyId: stories[0]!.id,
        status: "completed",
        attempt: 1,
        workerRole: "story-review-remediator",
        inputSnapshotJson: "{\"selectedFindingIds\":[]}",
        systemPromptSnapshot: "story remediation prompt",
        skillsSnapshotJson: JSON.stringify([{ path: "skills/execution-implementer.md", content: "Execution skill" }]),
        gitBranchName: "fix/ITEM-0001-P01-US01/story_review_run_1",
        gitBaseRef: "proj/ITEM-0001-P01",
        gitMetadataJson: "{\"strategy\":\"simulated\"}",
        outputSummaryJson: "{\"status\":\"completed\"}",
        errorMessage: null
      });
      const remediationFindings = storyReviewRemediationFindingRepository.createMany([
        {
          storyReviewRemediationRunId: remediationRun.id,
          storyReviewFindingId: storyReviewFindings[0]!.id,
          resolutionStatus: "resolved"
        }
      ]);
      const remediationSession = storyReviewRemediationAgentSessionRepository.create({
        storyReviewRemediationRunId: remediationRun.id,
        adapterKey: "local-cli",
        status: "completed",
        commandJson: "[\"node\"]",
        stdout: "{}",
        stderr: "",
        exitCode: 0
      });
      const documentationRun = documentationRunRepository.create({
        projectId: projects[0]!.id,
        status: "review_required",
        inputSnapshotJson: "{\"projectCode\":\"ITEM-0001-P01\"}",
        systemPromptSnapshot: "documentation prompt",
        skillsSnapshotJson: JSON.stringify([{ path: "skills/documentation-writer.md", content: "Documentation skill" }]),
        staleAt: null,
        staleReason: null,
        summaryJson: "{\"overallStatus\":\"review_required\",\"artifactIds\":[]}",
        errorMessage: null
      });
      const documentationSession = documentationAgentSessionRepository.create({
        documentationRunId: documentationRun.id,
        adapterKey: "local-cli",
        status: "completed",
        commandJson: "[\"node\"]",
        stdout: "{}",
        stderr: "",
        exitCode: 0
      });
      const interactiveReviewSession = interactiveReviewSessionRepository.create({
        scopeType: "project",
        scopeId: projects[0]!.id,
        artifactType: "stories",
        reviewType: "collection_review",
        status: "open"
      });
      const interactiveReviewMessage = interactiveReviewMessageRepository.create({
        sessionId: interactiveReviewSession.id,
        role: "assistant",
        content: "Review started",
        structuredPayloadJson: null,
        derivedUpdatesJson: null
      });
      const interactiveReviewEntries = interactiveReviewEntryRepository.createMany([
        {
          sessionId: interactiveReviewSession.id,
          entryType: "story",
          entryId: stories[0]!.id,
          title: stories[0]!.title,
          status: "pending",
          summary: null,
          changeRequest: null,
          rationale: null,
          severity: null
        }
      ]);
      interactiveReviewEntryRepository.updateByEntryId(interactiveReviewSession.id, stories[0]!.id, {
        status: "needs_revision",
        summary: "Story needs clarification",
        changeRequest: "Clarify acceptance criteria",
        severity: "medium"
      });
      const interactiveReviewResolution = interactiveReviewResolutionRepository.create({
        sessionId: interactiveReviewSession.id,
        resolutionType: "request_changes",
        payloadJson: "{\"rationale\":\"scope unclear\"}"
      });
      interactiveReviewResolutionRepository.markApplied(interactiveReviewResolution.id);
      interactiveReviewSessionRepository.update(interactiveReviewSession.id, {
        lastAssistantMessageId: interactiveReviewMessage.id,
        status: "ready_for_resolution"
      });

      expect(architecturePlan.id).toContain("architecture_");
      expect(implementationPlan.id).toContain("plan_");
      expect(waveStories[0]?.id).toContain("wave_story_");
      expect(dependencies).toHaveLength(1);
      expect(dependencies[0]).toEqual({
        blockingStoryId: stories[0]!.id,
        dependentStoryId: stories[1]!.id
      });
      expect(projectExecutionContext.relevantDirectories).toEqual(["src"]);
      expect(waveExecution.id).toContain("wave_execution_");
      expect(waveStoryTestRun.id).toContain("wave_story_test_run_");
      expect(testSession.id).toContain("test_session_");
      expect(waveStoryExecution.testPreparationRunId).toBe(waveStoryTestRun.id);
      expect(waveStoryExecution.id).toContain("wave_story_execution_");
      expect(executionSession.id).toContain("execution_session_");
      expect(verificationRun.id).toContain("verification_");
      expect(appVerificationRun.id).toContain("app_verification_run_");
      expect(appVerificationRunRepository.getLatestByWaveStoryExecutionId(waveStoryExecution.id)?.status).toBe("passed");
      expect(appVerificationRunRepository.listByWaveStoryExecutionId(waveStoryExecution.id)).toHaveLength(1);
      expect(storyReviewRun.id).toContain("story_review_run_");
      expect(storyReviewRunRepository.getLatestByWaveStoryExecutionId(waveStoryExecution.id)?.status).toBe("review_required");
      expect(storyReviewFindings[0]?.line).toBe(123);
      expect(storyReviewFindingRepository.listByStoryReviewRunId(storyReviewRun.id)).toHaveLength(1);
      expect(storyReviewSession.id).toContain("story_review_session_");
      expect(storyReviewAgentSessionRepository.listByStoryReviewRunId(storyReviewRun.id)).toHaveLength(1);
      expect(qualityKnowledgeEntries[0]?.id).toContain("quality_knowledge_");
      expect(
        qualityKnowledgeEntryRepository.listRelevantForStory({
          workspaceId: defaultWorkspace!.id,
          projectId: projects[0]!.id,
          waveId: createdWaves[0]!.id,
          storyId: stories[0]!.id,
          filePaths: ["src/persistence/repositories.ts"],
          modules: ["src/persistence"]
        })
      ).toHaveLength(1);
      expect(remediationRun.id).toContain("story_review_remediation_run_");
      expect(storyReviewRemediationRunRepository.listByStoryId(stories[0]!.id)).toHaveLength(1);
      expect(remediationFindings[0]?.resolutionStatus).toBe("resolved");
      expect(storyReviewRemediationFindingRepository.listByRunId(remediationRun.id)).toHaveLength(1);
      expect(remediationSession.id).toContain("story_review_remediation_session_");
      expect(storyReviewRemediationAgentSessionRepository.listByRunId(remediationRun.id)).toHaveLength(1);
      expect(qaRun.id).toContain("qa_run_");
      expect(qaRunRepository.getLatestByProjectId(projects[0]!.id)?.status).toBe("review_required");
      expect(qaRunRepository.listByProjectId(projects[0]!.id)).toHaveLength(1);
      expect(qaFindings[0]?.reproSteps).toEqual(["Open the relevant flow", "Submit twice quickly"]);
      expect(qaFindingRepository.listByQaRunId(qaRun.id)).toHaveLength(1);
      expect(qaSession.id).toContain("qa_session_");
      expect(qaAgentSessionRepository.listByQaRunId(qaRun.id)).toHaveLength(1);
      expect(documentationRun.id).toContain("documentation_run_");
      expect(documentationRunRepository.getLatestByProjectId(projects[0]!.id)?.status).toBe("review_required");
      expect(documentationRunRepository.listByProjectId(projects[0]!.id)).toHaveLength(1);
      expect(documentationSession.id).toContain("documentation_session_");
      expect(documentationAgentSessionRepository.listByDocumentationRunId(documentationRun.id)).toHaveLength(1);
      expect(interactiveReviewSessionRepository.findOpenByScope({
        scopeType: "project",
        scopeId: projects[0]!.id,
        artifactType: "stories",
        reviewType: "collection_review"
      })?.id).toBe(interactiveReviewSession.id);
      expect(interactiveReviewMessageRepository.listBySessionId(interactiveReviewSession.id)).toHaveLength(1);
      expect(interactiveReviewEntries[0]?.id).toContain("interactive_review_entry_");
      expect(interactiveReviewEntryRepository.listBySessionId(interactiveReviewSession.id)[0]?.status).toBe("needs_revision");
      expect(interactiveReviewResolutionRepository.listBySessionId(interactiveReviewSession.id)[0]?.appliedAt).not.toBeNull();
    } finally {
      testDb.cleanup();
    }
  });

  it("stores artifact metadata", () => {
    const testDb = createTestDatabase();
    const db = createDatabase(testDb.filePath).db;
    const itemRepository = new ItemRepository(db);
    const workspaceRepository = new WorkspaceRepository(db);
    const artifactRepository = new ArtifactRepository(db);

    try {
      const defaultWorkspace = workspaceRepository.getByKey("default");
      const item = itemRepository.create({ workspaceId: defaultWorkspace!.id, title: "Item", description: "Desc" });
      const artifact = artifactRepository.create({
        stageRunId: null,
        itemId: item.id,
        projectId: null,
        kind: "concept",
        format: "md",
        path: "items/test/concept.md",
        sha256: "abc",
        sizeBytes: 12
      });

      expect(artifact.id).toContain("artifact_");
    } finally {
      testDb.cleanup();
    }
  });

  it("allocates sequential item codes", () => {
    const testDb = createTestDatabase();
    const db = createDatabase(testDb.filePath).db;
    const itemRepository = new ItemRepository(db);
    const workspaceRepository = new WorkspaceRepository(db);

    try {
      const defaultWorkspace = workspaceRepository.getByKey("default");
      const first = itemRepository.create({ workspaceId: defaultWorkspace!.id, title: "First", description: "Desc" });
      const second = itemRepository.create({ workspaceId: defaultWorkspace!.id, title: "Second", description: "Desc" });

      expect(first.code).toBe("ITEM-0001");
      expect(second.code).toBe("ITEM-0002");
    } finally {
      testDb.cleanup();
    }
  });

  it("allocates item codes independently per workspace", () => {
    const testDb = createTestDatabase();
    const db = createDatabase(testDb.filePath).db;
    const itemRepository = new ItemRepository(db);
    const workspaceRepository = new WorkspaceRepository(db);
    const workspaceSettingsRepository = new WorkspaceSettingsRepository(db);

    try {
      const defaultWorkspace = workspaceRepository.getByKey("default")!;
      const secondWorkspace = workspaceRepository.create({
        key: "second",
        name: "Second Workspace",
        description: null,
        rootPath: null
      });
      workspaceSettingsRepository.create({
        workspaceId: secondWorkspace.id,
        defaultAdapterKey: null,
        defaultModel: null,
        runtimeProfileJson: null,
        autorunPolicyJson: null,
        promptOverridesJson: null,
        skillOverridesJson: null,
        verificationDefaultsJson: null,
        qaDefaultsJson: null,
        gitDefaultsJson: null,
        executionDefaultsJson: null,
        appTestConfigJson: null,
        uiMetadataJson: null
      });

      const defaultItem = itemRepository.create({ workspaceId: defaultWorkspace.id, title: "Default", description: "Desc" });
      const secondItem = itemRepository.create({
        workspaceId: secondWorkspace.id,
        title: "Second",
        description: "Desc"
      });

      expect(defaultItem.code).toBe("ITEM-0001");
      expect(secondItem.code).toBe("ITEM-0001");
      expect(itemRepository.listByWorkspaceId(secondWorkspace.id)).toHaveLength(1);
    } finally {
      testDb.cleanup();
    }
  });

  it("rolls back a failed multi insert transaction", () => {
    const testDb = createTestDatabase();
    const { connection, db } = createDatabase(testDb.filePath);
    applyMigrations(connection, baseMigrations);
    const itemRepository = new ItemRepository(db);
    const workspaceRepository = new WorkspaceRepository(db);
    const conceptRepository = new ConceptRepository(db);

    try {
      const defaultWorkspace = workspaceRepository.getByKey("default");
      const item = itemRepository.create({ workspaceId: defaultWorkspace!.id, title: "Item", description: "Desc" });
      const concept = conceptRepository.create({
        itemId: item.id,
        version: 1,
        title: "Concept",
        summary: "Summary",
        status: "draft",
        markdownArtifactId: "artifact_md",
        structuredArtifactId: "artifact_json"
      });

      expect(() =>
        connection.transaction(() => {
          connection.prepare("INSERT INTO projects (id, item_id, code, concept_id, title, summary, goal, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            "project_1",
            item.id,
            `${item.code}-P01`,
            concept.id,
            "Project 1",
            "Summary",
            "Goal",
            "draft",
            0,
            Date.now(),
            Date.now()
          );
          connection.prepare("INSERT INTO projects (id, item_id, code, concept_id, title, summary, goal, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            "project_2",
            item.id,
            `${item.code}-P02`,
            "missing_concept",
            "Project 2",
            "Summary",
            "Goal",
            "draft",
            1,
            Date.now(),
            Date.now()
          );
        })()
      ).toThrow();

      const count = connection.prepare("SELECT count(*) as count FROM projects").get() as { count: number };
      expect(count.count).toBe(0);
    } finally {
      connection.close();
      testDb.cleanup();
    }
  });
});
