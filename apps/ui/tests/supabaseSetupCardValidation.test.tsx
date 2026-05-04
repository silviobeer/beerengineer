import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseSetupCard } from "@/components/setup/SupabaseSetupCard";

describe("SupabaseSetupCard project-ref validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("declares the project-ref pattern and maxLength on the input", () => {
    render(<SupabaseSetupCard workspaceId="ws-1" />);
    const input = screen.getByLabelText("Supabase project ref") as HTMLInputElement;
    expect(input.getAttribute("pattern")).toBe("^[a-z]{20}$");
    expect(input.getAttribute("maxLength")).toBe("20");
  });

  it("keeps the submit button disabled and does not call the engine when the project ref is invalid", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<SupabaseSetupCard workspaceId="ws-1" />);

    fireEvent.change(screen.getByLabelText("Supabase Management API token"), { target: { value: "sbp_token" } });
    fireEvent.change(screen.getByLabelText("Supabase project ref"), {
      target: { value: "<script>alert(1)</script>" },
    });

    const button = screen.getByRole("button", { name: "Validate Supabase" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows an inline error explaining the expected format when invalid input is entered", () => {
    render(<SupabaseSetupCard workspaceId="ws-1" />);
    fireEvent.change(screen.getByLabelText("Supabase Management API token"), { target: { value: "sbp_token" } });
    fireEvent.change(screen.getByLabelText("Supabase project ref"), { target: { value: "TOO-SHORT" } });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Project ref must be 20 lowercase letters (e.g. abcdefghijklmnopqrst)",
    );
  });

  it("enables the submit button and accepts a valid 20-letter project ref", () => {
    render(<SupabaseSetupCard workspaceId="ws-1" />);
    fireEvent.change(screen.getByLabelText("Supabase Management API token"), { target: { value: "sbp_token" } });
    fireEvent.change(screen.getByLabelText("Supabase project ref"), { target: { value: "abcdefghijklmnopqrst" } });

    const button = screen.getByRole("button", { name: "Validate Supabase" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
