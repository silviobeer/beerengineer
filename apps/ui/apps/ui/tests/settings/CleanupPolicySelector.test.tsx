import "../../../../tests/setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CleanupPolicySelector } from "@/components/settings/CleanupPolicySelector";

describe("CleanupPolicySelector", () => {
  it("shows read-only wave granularity and validates ttl/manual states", () => {
    const onChange = vi.fn();
    render(<CleanupPolicySelector policy="on-success-immediate" onChange={onChange} />);
    expect(screen.getByDisplayValue("wave")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Cleanup policy"), { target: { value: "ttl-after-success" } });
    fireEvent.change(screen.getByLabelText("TTL hours"), { target: { value: "0" } });
    expect(screen.getByText("TTL hours must be a positive integer.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("TTL hours"), { target: { value: "24" } });
    expect(onChange).toHaveBeenLastCalledWith({ cleanupPolicy: "ttl-after-success", cleanupTtlHours: 24, valid: true });
    fireEvent.change(screen.getByLabelText("Cleanup policy"), { target: { value: "manual" } });
    expect(screen.getByText(/branches will accumulate/i)).toBeInTheDocument();
  });
});
