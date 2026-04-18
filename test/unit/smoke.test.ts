import { describe, expect, it } from "vitest";

import { failure, success } from "../../src/shared/result.js";

describe("result helpers", () => {
  it("creates success and failure values", () => {
    expect(success("ok")).toEqual({ ok: true, value: "ok" });
    expect(failure("error")).toEqual({ ok: false, error: "error" });
  });
});
