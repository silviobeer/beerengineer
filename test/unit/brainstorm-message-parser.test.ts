import { describe, expect, it } from "vitest";

import {
  extractLabeledBrainstormLists,
  hasAnyExtraction
} from "../../src/workflow/brainstorm-message-parser.js";

describe("extractLabeledBrainstormLists", () => {
  it("extracts inline semicolon-separated entries for target users and use cases", () => {
    const result = extractLabeledBrainstormLists(
      [
        "problem: Teams lack visibility",
        "users: support operator; delivery lead",
        "use cases: inspect sessions; spot blockers"
      ].join("\n")
    );
    expect(result.targetUsers).toEqual(["support operator", "delivery lead"]);
    expect(result.useCases).toEqual(["inspect sessions", "spot blockers"]);
    expect(result.constraints).toEqual([]);
  });

  it("extracts multi-line bulleted sections", () => {
    const result = extractLabeledBrainstormLists(
      [
        "Target users:",
        "- product operator",
        "- delivery lead",
        "",
        "Use cases:",
        "- review overlay",
        "- browse inbox",
        "",
        "Constraints:",
        "- must run offline",
        "- no external network"
      ].join("\n")
    );
    expect(result.targetUsers).toEqual(["product operator", "delivery lead"]);
    expect(result.useCases).toEqual(["review overlay", "browse inbox"]);
    expect(result.constraints).toEqual(["must run offline", "no external network"]);
  });

  it("recognizes non-goals, risks, and assumptions labels", () => {
    const result = extractLabeledBrainstormLists(
      [
        "Non-Goals:",
        "- multi-tenant sharing",
        "Risks:",
        "- unbounded artifact storage",
        "Assumptions:",
        "- local-only workflow"
      ].join("\n")
    );
    expect(result.nonGoals).toEqual(["multi-tenant sharing"]);
    expect(result.risks).toEqual(["unbounded artifact storage"]);
    expect(result.assumptions).toEqual(["local-only workflow"]);
  });

  it("dedupes and trims whitespace", () => {
    const result = extractLabeledBrainstormLists(
      ["users: Alice;  Alice  ; bob", "Users:", "- alice", "- charlie"].join("\n")
    );
    expect(result.targetUsers).toEqual(["Alice", "bob", "charlie"]);
  });

  it("returns empty extraction for unlabeled prose", () => {
    const result = extractLabeledBrainstormLists("We want to improve the onboarding flow for customers.");
    expect(hasAnyExtraction(result)).toBe(false);
  });

  it("stops collecting bullets when a blank line appears", () => {
    const result = extractLabeledBrainstormLists(
      ["Use cases:", "- inspect sessions", "", "- stray bullet after blank line"].join("\n")
    );
    expect(result.useCases).toEqual(["inspect sessions"]);
  });
});
