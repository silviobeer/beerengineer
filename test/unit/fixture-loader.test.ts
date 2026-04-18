import { describe, expect, it } from "vitest";

import { loadFixture } from "../helpers/fixtures.js";

describe("fixture loader", () => {
  it("loads fixture files from disk", () => {
    const fixture = loadFixture("sample.json");

    expect(JSON.parse(fixture)).toEqual({
      hello: "world",
      version: 1
    });
  });
});
