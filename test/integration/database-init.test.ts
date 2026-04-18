import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../helpers/database.js";

describe("database initialization", () => {
  it("creates a migrated sqlite database", () => {
    const testDb = createTestDatabase();

    try {
      const row = testDb.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("__migrations") as { name: string } | undefined;

      expect(row?.name).toBe("__migrations");
    } finally {
      testDb.cleanup();
    }
  });
});
