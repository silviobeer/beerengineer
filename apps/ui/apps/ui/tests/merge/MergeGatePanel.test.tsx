import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MergeGatePanel } from "@/components/merge/MergeGatePanel";

describe("MergeGatePanel", () => {
  it("PROJ-4 PRD-9 US-3: renders four gates, block reasons, settings deep link, and acknowledge action", () => {
    const acknowledge = vi.fn();
    render(<MergeGatePanel onAcknowledgeDestructive={acknowledge} gates={{
      finalValidation: { status: "pass", reason: "final wave validated" },
      protectionSwitch: { status: "block", reason: "protection switch off" },
      destructiveConfirmation: { status: "block", reason: "destructive operations require per-merge confirmation", operations: [{ kind: "drop-table", file: "001.sql", line: 1, redactedSnippet: "drop table users" }] },
      productionMigration: { status: "skipped", reason: "production-migration-skipped-because-off" },
    }} />);
    expect(screen.getByText("Final validation")).toBeInTheDocument();
    expect(screen.getByText("Protection switch")).toBeInTheDocument();
    expect(screen.getByText("Destructive confirmation")).toBeInTheDocument();
    expect(screen.getByText("Production migration")).toBeInTheDocument();
    expect(screen.getByText("protection switch off")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open settings" })).toHaveAttribute("href", "/settings#supabase");
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(acknowledge).toHaveBeenCalledOnce();
  });
});
