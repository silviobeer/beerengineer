import { describe, expect, it } from "vitest";

import { parseGitRemoteRepository } from "../../src/shared/git-remote.js";

describe("parseGitRemoteRepository", () => {
  it("parses standard ssh and https repository remotes", () => {
    expect(parseGitRemoteRepository("git@github.com:silviobeer/beerengineer.git")).toEqual({
      organization: "silviobeer",
      repository: "beerengineer"
    });
    expect(parseGitRemoteRepository("https://github.com/silviobeer/beerengineer.git")).toEqual({
      organization: "silviobeer",
      repository: "beerengineer"
    });
  });

  it("rejects multi-segment repository paths instead of guessing the owner", () => {
    expect(parseGitRemoteRepository("https://github.example.com/a/b/c")).toBeNull();
    expect(parseGitRemoteRepository("git@example.com:a/b/c.git")).toBeNull();
  });
});
