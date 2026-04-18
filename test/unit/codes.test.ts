import { describe, expect, it } from "vitest";

import {
  formatAcceptanceCriterionCode,
  formatItemCode,
  formatProjectCode,
  formatStoryCode,
  parseItemCodeSequence
} from "../../src/shared/codes.js";

describe("codes", () => {
  it("formats hierarchical record codes", () => {
    expect(formatItemCode(12)).toBe("ITEM-0012");
    expect(formatProjectCode("ITEM-0012", 3)).toBe("ITEM-0012-P03");
    expect(formatStoryCode("ITEM-0012-P03", 4)).toBe("ITEM-0012-P03-US04");
    expect(formatAcceptanceCriterionCode("ITEM-0012-P03-US04", 5)).toBe("ITEM-0012-P03-US04-AC05");
  });

  it("parses item code sequences", () => {
    expect(parseItemCodeSequence("ITEM-0042")).toBe(42);
    expect(parseItemCodeSequence("bad")).toBeNull();
  });
});
