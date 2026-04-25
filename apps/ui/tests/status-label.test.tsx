import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { deriveStatusLabel } from "@/lib/statusLabel";
import { ItemCard } from "@/components/ItemCard";
import { makeItem } from "@/lib/fixtures";

describe("deriveStatusLabel (TC-1.2b)", () => {
  it.each<[string, string | null, string]>([
    ["running", "plan", "Running – Plan"],
    ["running", "exec", "Running – Exec"],
    ["running", null, "Running"],
    ["done", "exec", "Done"],
    ["prompt", "review", "Awaiting Input"],
    ["openPrompt", null, "Awaiting Input"],
    ["failed", "arch", "Failed"],
    ["review", null, "Awaiting Review"],
    ["review-gate-waiting", null, "Awaiting Review"],
    ["blocked", null, "Blocked"],
    ["run-blocked", null, "Blocked"],
    ["idle", null, "Idle"],
  ])(
    "phase_status='%s' + current_stage='%s' → label '%s'",
    (status, stage, expected) => {
      expect(deriveStatusLabel(status, stage)).toBe(expected);
    }
  );

  it("unknown phase_status falls through to the raw value", () => {
    expect(deriveStatusLabel("flibbertigibbet", null)).toBe("flibbertigibbet");
  });

  it("empty / null phase_status returns 'Unknown' label rather than blank", () => {
    expect(deriveStatusLabel("", null)).toBe("Unknown");
    expect(deriveStatusLabel(null, null)).toBe("Unknown");
    expect(deriveStatusLabel(undefined, null)).toBe("Unknown");
  });
});

describe("StatusChip rendering inside ItemCard (TC-1.2b)", () => {
  it.each<[string, string, string]>([
    ["running", "plan", "Running – Plan"],
    ["done", "exec", "Done"],
    ["prompt", "review", "Awaiting Input"],
    ["failed", "arch", "Failed"],
  ])(
    "ItemCard chip for (%s, %s) shows '%s'",
    (status, stage, expected) => {
      render(
        <ItemCard
          item={makeItem({
            id: `chip-${status}`,
            pipelineState: status,
            current_stage: stage,
          })}
          workspaceKey="demo"
        />
      );
      const chip = screen.getByTestId("status-chip");
      expect(chip.textContent).toBe(expected);
      expect(chip.dataset.label).toBe(expected);
    }
  );

  it("chip for an Implementation-column running item includes the active stage", () => {
    render(
      <ItemCard
        item={makeItem({
          id: "impl-chip",
          phase: "Implementation",
          pipelineState: "running",
          current_stage: "plan",
        })}
        workspaceKey="demo"
      />
    );
    expect(screen.getByTestId("status-chip").textContent).toBe(
      "Running – Plan"
    );
  });
});
