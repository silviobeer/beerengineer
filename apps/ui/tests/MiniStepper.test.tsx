import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MiniStepper } from "@/components/MiniStepper";

const SEGMENT_LABELS = ["Arch", "Plan", "Exec", "Review", "QA", "Doc"];
const SEGMENT_KEYS = ["arch", "plan", "exec", "review", "qa", "doc"] as const;

function getSegments() {
  const stepper = screen.getByTestId("mini-stepper");
  return within(stepper).getAllByRole("listitem");
}

describe("MiniStepper (US-02)", () => {
  it("TC-01: renders all six implementation segments labeled Arch, Plan, Exec, Review, QA, Doc in order (Merge is its own board column, not a stepper segment)", () => {
    render(<MiniStepper stage="arch" />);
    const segments = getSegments();
    expect(segments).toHaveLength(6);
    expect(segments.map((el) => el.textContent?.trim())).toEqual(SEGMENT_LABELS);
    expect(segments.map((el) => el.getAttribute("data-segment"))).toEqual([
      ...SEGMENT_KEYS,
    ]);
  });

  it.each([
    ["arch", "Arch"],
    ["plan", "Plan"],
    ["exec", "Exec"],
    ["review", "Review"],
    ["qa", "QA"],
    ["doc", "Doc"],
  ] as const)(
    "TC-02..TC-07: stage='%s' activates only the %s segment",
    (stage, activeLabel) => {
      render(<MiniStepper stage={stage} />);
      const segments = getSegments();
      const activeSegments = segments.filter(
        (el) => el.getAttribute("data-active") === "true"
      );
      expect(activeSegments).toHaveLength(1);
      expect(activeSegments[0].textContent?.trim()).toBe(activeLabel);
      expect(activeSegments[0].getAttribute("aria-current")).toBe("step");

      const inactiveSegments = segments.filter(
        (el) => el.getAttribute("data-active") === "false"
      );
      expect(inactiveSegments).toHaveLength(5);
      for (const el of inactiveSegments) {
        expect(el.getAttribute("aria-current")).toBeNull();
      }
    }
  );

  it("TC-06: unrecognised stage value renders all segments inactive without throwing", () => {
    expect(() => render(<MiniStepper stage="something_unknown" />)).not.toThrow();
    const segments = getSegments();
    expect(segments).toHaveLength(6);
    expect(segments.map((el) => el.textContent?.trim())).toEqual(SEGMENT_LABELS);
    for (const el of segments) {
      expect(el.getAttribute("data-active")).toBe("false");
      expect(el.getAttribute("aria-current")).toBeNull();
    }
  });

  it("TC-07: missing/null stage renders all segments inactive without throwing", () => {
    for (const stage of [null, undefined] as const) {
      const { unmount } = render(<MiniStepper stage={stage} />);
      const segments = getSegments();
      expect(segments).toHaveLength(6);
      for (const el of segments) {
        expect(el.getAttribute("data-active")).toBe("false");
      }
      unmount();
    }
  });

  it("EC-01: empty-string stage renders all segments inactive without throwing", () => {
    expect(() => render(<MiniStepper stage="" />)).not.toThrow();
    const segments = getSegments();
    for (const el of segments) {
      expect(el.getAttribute("data-active")).toBe("false");
    }
  });
});
