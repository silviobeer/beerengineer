import { test } from "node:test"
import assert from "node:assert/strict"

import {
  nextClarificationQuestion as nextVisualClarificationQuestion,
  parseClarificationModeReply as parseVisualClarificationModeReply,
} from "../src/stages/visual-companion/index.js"
import type { VisualCompanionState } from "../src/stages/visual-companion/types.js"
import {
  nextClarificationQuestion as nextFrontendClarificationQuestion,
  parseClarificationModeReply as parseFrontendClarificationModeReply,
} from "../src/stages/frontend-design/index.js"
import type { FrontendDesignState } from "../src/stages/frontend-design/types.js"

function visualState(overrides: Partial<VisualCompanionState> = {}): VisualCompanionState {
  return {
    input: {
      itemConcept: { summary: "", problem: "", users: [], constraints: [], hasUi: true },
      projects: [],
    },
    inputMode: "none",
    references: [],
    history: [],
    clarificationCount: 0,
    maxClarifications: 3,
    userReviewRound: 0,
    ...overrides,
  }
}

function frontendState(overrides: Partial<FrontendDesignState> = {}): FrontendDesignState {
  return {
    input: {
      itemConcept: { summary: "", problem: "", users: [], constraints: [], hasUi: true },
      projects: [],
    },
    inputMode: "none",
    references: [],
    history: [],
    clarificationCount: 0,
    maxClarifications: 3,
    userReviewRound: 0,
    ...overrides,
  }
}

test("visual-companion clarification mode only accepts exact none or references", () => {
  assert.equal(parseVisualClarificationModeReply("none"), "none")
  assert.equal(parseVisualClarificationModeReply("references"), "references")
  assert.equal(parseVisualClarificationModeReply(" check out https://example.com "), null)
})

test("visual-companion asks for actual references before priorities when references mode is selected", () => {
  assert.match(nextVisualClarificationQuestion(visualState({ clarificationCount: 0 })) ?? "", /exactly `none` or `references`/)
  assert.match(
    nextVisualClarificationQuestion(visualState({ clarificationCount: 1, inputMode: "references" })) ?? "",
    /Share the references, mockups, or links/,
  )
  assert.match(
    nextVisualClarificationQuestion(visualState({ clarificationCount: 2, inputMode: "references" })) ?? "",
    /highest priority/,
  )
})

test("frontend-design clarification mode only accepts exact none or references", () => {
  assert.equal(parseFrontendClarificationModeReply("none"), "none")
  assert.equal(parseFrontendClarificationModeReply("references"), "references")
  assert.equal(parseFrontendClarificationModeReply("https://dribbble.com/example"), null)
})

test("frontend-design asks for actual references before visual tone when references mode is selected", () => {
  assert.match(nextFrontendClarificationQuestion(frontendState({ clarificationCount: 0 })) ?? "", /exactly `none` or `references`/)
  assert.match(
    nextFrontendClarificationQuestion(frontendState({ clarificationCount: 1, inputMode: "references" })) ?? "",
    /Share the design system, brand references, or example apps/,
  )
  assert.match(
    nextFrontendClarificationQuestion(frontendState({ clarificationCount: 2, inputMode: "references" })) ?? "",
    /visual tone/,
  )
})
