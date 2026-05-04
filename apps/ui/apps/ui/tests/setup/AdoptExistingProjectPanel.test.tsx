import "../../../../tests/setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdoptExistingProjectPanel } from "@/components/setup/AdoptExistingProjectPanel";

describe("AdoptExistingProjectPanel", () => {
  it("collapses when the project is empty", () => {
    const { container } = render(<AdoptExistingProjectPanel state={{ occupancy: false, requiresBaseline: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("requires explicit confirmation for occupied projects", () => {
    const onConfirmChange = vi.fn();
    render(<AdoptExistingProjectPanel state={{ occupancy: true, requiresBaseline: false }} onConfirmChange={onConfirmChange} />);
    expect(screen.getByRole("button", { name: /create persistent test branch/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /create persistent test branch/i })).not.toBeDisabled();
    expect(onConfirmChange).toHaveBeenCalledWith(true);
  });

  it("blocks adoption and shows baseline commands when migrations do not match", () => {
    render(<AdoptExistingProjectPanel state={{ occupancy: true, requiresBaseline: true, reason: "remote_schema_without_local_migrations" }} />);
    expect(screen.getByRole("button", { name: /create persistent test branch/i })).toBeDisabled();
    expect(screen.getByText("supabase db pull")).toBeInTheDocument();
    expect(screen.getByText("supabase db diff")).toBeInTheDocument();
  });
});
