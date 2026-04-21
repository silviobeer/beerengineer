import { describe, expect, it } from "vitest";

import {
  extractBrainstormMessageStructure,
  extractLabeledBrainstormLists,
  hasAnyExtraction,
  mergeBrainstormMessageStructures
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

  it("extracts scalar brainstorm fields and extra list sections", () => {
    const result = extractBrainstormMessageStructure(
      [
        "Problem: Operators lack a real control panel",
        "Core outcome: Ship a workspace-first board and inbox shell",
        "Open questions:",
        "- What is the smallest useful slice?",
        "Candidate directions:",
        "- static shell first",
        "- board read models second",
        "Recommended direction: static shell first",
        "Scope notes:",
        "- showcase and component inventory are mandatory"
      ].join("\n")
    );
    expect(result.problem).toBe("Operators lack a real control panel");
    expect(result.coreOutcome).toBe("Ship a workspace-first board and inbox shell");
    expect(result.openQuestions).toEqual(["What is the smallest useful slice?"]);
    expect(result.candidateDirections).toEqual(["static shell first", "board read models second"]);
    expect(result.recommendedDirection).toBe("static shell first");
    expect(result.scopeNotes).toBe("showcase and component inventory are mandatory");
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

  it("merges multiple structured chat messages with latest scalar values and unioned lists", () => {
    const merged = mergeBrainstormMessageStructures([
      extractBrainstormMessageStructure(
        [
          "Problem: Operators rely on CLI output",
          "Users: workflow operator",
          "Use cases: review overlay"
        ].join("\n")
      ),
      extractBrainstormMessageStructure(
        [
          "Core outcome: Ship a board-first UI shell",
          "Users: reviewer",
          "Use cases: browse inbox",
          "Recommended direction: shell first"
        ].join("\n")
      )
    ]);

    expect(merged.problem).toBe("Operators rely on CLI output");
    expect(merged.coreOutcome).toBe("Ship a board-first UI shell");
    expect(merged.recommendedDirection).toBe("shell first");
    expect(merged.targetUsers).toEqual(["workflow operator", "reviewer"]);
    expect(merged.useCases).toEqual(["review overlay", "browse inbox"]);
  });

  it("extracts plan-like markdown headings and bullet sections without fragmenting comma phrases", () => {
    const result = extractBrainstormMessageStructure(
      [
        "# UI Shell Implementation Plan",
        "",
        "## Goal",
        "",
        "Implement a workspace-scoped UI shell for BeerEngineer.",
        "",
        "## Main Views",
        "",
        "- Board",
        "- Inbox",
        "- Runs",
        "- Artifacts",
        "",
        "## Overlay Panel Capabilities",
        "",
        "open an item overlay with status, timeline, next actions, and chat preview",
        "",
        "## Component Constraints",
        "",
        "- do not hardcode workflow logic inside visual components",
        "- implementation must include a UI showcase"
      ].join("\n")
    );

    expect(result.coreOutcome).toBe("Implement a workspace-scoped UI shell for BeerEngineer.");
    expect(result.useCases).toContain("Board");
    expect(result.useCases).toContain("Inbox");
    expect(result.useCases).toContain("Runs");
    expect(result.useCases).toContain("Artifacts");
    expect(result.useCases).toContain("open an item overlay with status, timeline, next actions, and chat preview");
    expect(result.constraints).toContain("do not hardcode workflow logic inside visual components");
    expect(result.constraints).toContain("implementation must include a UI showcase");
  });
});
