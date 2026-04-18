import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/persistence/database.js";
import { applyMigrations } from "../../src/persistence/migrator.js";
import { baseMigrations } from "../../src/persistence/migration-registry.js";
import {
  AcceptanceCriterionRepository,
  ArtifactRepository,
  ArchitecturePlanRepository,
  ConceptRepository,
  ExecutionAgentSessionRepository,
  ImplementationPlanRepository,
  ItemRepository,
  ProjectExecutionContextRepository,
  ProjectRepository,
  UserStoryRepository,
  VerificationRunRepository,
  WaveRepository,
  WaveExecutionRepository,
  WaveStoryDependencyRepository,
  WaveStoryExecutionRepository,
  WaveStoryRepository
} from "../../src/persistence/repositories.js";
import { createTestDatabase } from "../helpers/database.js";

describe("repositories", () => {
  it("supports item, concept and project CRUD", () => {
    const testDb = createTestDatabase();
    const db = createDatabase(testDb.filePath).db;
    const itemRepository = new ItemRepository(db);
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
    const waveStoryExecutionRepository = new WaveStoryExecutionRepository(db);
    const executionAgentSessionRepository = new ExecutionAgentSessionRepository(db);
    const verificationRunRepository = new VerificationRunRepository(db);
    const artifactRepository = new ArtifactRepository(db);

    try {
      const item = itemRepository.create({ title: "Item", description: "Desc" });
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
      const waveStoryExecution = waveStoryExecutionRepository.create({
        waveExecutionId: waveExecution.id,
        waveStoryId: waveStories[0]!.id,
        storyId: stories[0]!.id,
        status: "completed",
        attempt: 1,
        workerRole: "backend-implementer",
        businessContextSnapshotJson: "{\"story\":\"ITEM-0001-P01-US01\"}",
        repoContextSnapshotJson: "{\"files\":[\"src/workflow/workflow-service.ts\"]}",
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
        status: "passed",
        summaryJson: "{\"testsRun\":[{\"command\":\"npm test\",\"status\":\"passed\"}]}",
        errorMessage: null
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
      expect(waveStoryExecution.id).toContain("wave_story_execution_");
      expect(executionSession.id).toContain("execution_session_");
      expect(verificationRun.id).toContain("verification_");
    } finally {
      testDb.cleanup();
    }
  });

  it("stores artifact metadata", () => {
    const testDb = createTestDatabase();
    const db = createDatabase(testDb.filePath).db;
    const itemRepository = new ItemRepository(db);
    const artifactRepository = new ArtifactRepository(db);

    try {
      const item = itemRepository.create({ title: "Item", description: "Desc" });
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

    try {
      const first = itemRepository.create({ title: "First", description: "Desc" });
      const second = itemRepository.create({ title: "Second", description: "Desc" });

      expect(first.code).toBe("ITEM-0001");
      expect(second.code).toBe("ITEM-0002");
    } finally {
      testDb.cleanup();
    }
  });

  it("rolls back a failed multi insert transaction", () => {
    const testDb = createTestDatabase();
    const { connection, db } = createDatabase(testDb.filePath);
    applyMigrations(connection, baseMigrations);
    const itemRepository = new ItemRepository(db);
    const conceptRepository = new ConceptRepository(db);

    try {
      const item = itemRepository.create({ title: "Item", description: "Desc" });
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
