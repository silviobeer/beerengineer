import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase } from "../../../../src/persistence/database";
import { baseMigrations } from "../../../../src/persistence/migration-registry";
import { applyMigrations } from "../../../../src/persistence/migrator";
import {
  ItemRepository,
  WorkspaceRepository,
  WorkspaceSettingsRepository
} from "../../../../src/persistence/repositories";

const fixtureDbPath = resolve(__dirname, "..", "..", ".tmp", "board-e2e.sqlite");

export default async function globalSetup() {
  rmSync(fixtureDbPath, { force: true });

  const { connection, db } = createDatabase(fixtureDbPath);
  applyMigrations(connection, baseMigrations);

  const workspaceRepository = new WorkspaceRepository(db);
  const workspaceSettingsRepository = new WorkspaceSettingsRepository(db);
  const itemRepository = new ItemRepository(db);

  const alpha = workspaceRepository.create({
    key: "alpha",
    name: "Alpha Workspace",
    description: "Primary delivery scope",
    rootPath: null
  });
  const beta = workspaceRepository.create({
    key: "beta",
    name: "Beta Workspace",
    description: "Secondary validation scope",
    rootPath: null
  });
  const empty = workspaceRepository.create({
    key: "empty",
    name: "Empty Workspace",
    description: "No persisted items yet",
    rootPath: null
  });
  const broken = workspaceRepository.create({
    key: "broken",
    name: "Broken Workspace",
    description: "Used to simulate a live-data failure state",
    rootPath: null
  });

  for (const workspace of [alpha, beta, empty, broken]) {
    workspaceSettingsRepository.create({
      workspaceId: workspace.id,
      defaultAdapterKey: null,
      defaultModel: null,
      runtimeProfileJson: null,
      autorunPolicyJson: null,
      promptOverridesJson: null,
      skillOverridesJson: null,
      verificationDefaultsJson: null,
      appTestConfigJson: null,
      qaDefaultsJson: null,
      gitDefaultsJson: null,
      executionDefaultsJson: null,
      uiMetadataJson: null
    });
  }

  const alphaIdea = itemRepository.create({
    workspaceId: alpha.id,
    title: "Live board shell integration",
    description: "Server-side board view is backed by real BeerEngineer workspace items."
  });
  const alphaImplementation = itemRepository.create({
    workspaceId: alpha.id,
    title: "Live read adapter hardening",
    description: "Wire the UI shell to persisted workflow state without fixture-backed cards."
  });
  const betaDone = itemRepository.create({
    workspaceId: beta.id,
    title: "Release readiness verification",
    description: "Secondary workspace proves board data re-scopes when the active workspace changes."
  });

  itemRepository.updateColumn(alphaIdea.id, "idea", "draft");
  itemRepository.updateColumn(alphaImplementation.id, "implementation", "failed");
  itemRepository.updateColumn(betaDone.id, "done", "completed");

  connection.close();
}
