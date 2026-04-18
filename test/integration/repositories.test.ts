import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/persistence/database.js";
import { applyMigrations } from "../../src/persistence/migrator.js";
import { baseMigrations } from "../../src/persistence/migration-registry.js";
import {
  ArtifactRepository,
  ConceptRepository,
  ItemRepository,
  ProjectRepository
} from "../../src/persistence/repositories.js";
import { createTestDatabase } from "../helpers/database.js";

describe("repositories", () => {
  it("supports item, concept and project CRUD", () => {
    const testDb = createTestDatabase();
    const db = createDatabase(testDb.filePath).db;
    const itemRepository = new ItemRepository(db);
    const conceptRepository = new ConceptRepository(db);
    const projectRepository = new ProjectRepository(db);

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
          conceptId: concept.id,
          title: "Project",
          summary: "Summary",
          goal: "Goal",
          status: "draft",
          position: 0
        }
      ]);

      expect(itemRepository.getById(item.id)?.title).toBe("Item");
      expect(conceptRepository.getLatestByItemId(item.id)?.id).toBe(concept.id);
      expect(projects).toHaveLength(1);
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
          connection.prepare("INSERT INTO projects (id, item_id, concept_id, title, summary, goal, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            "project_1",
            item.id,
            concept.id,
            "Project 1",
            "Summary",
            "Goal",
            "draft",
            0,
            Date.now(),
            Date.now()
          );
          connection.prepare("INSERT INTO projects (id, item_id, concept_id, title, summary, goal, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            "project_2",
            item.id,
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
