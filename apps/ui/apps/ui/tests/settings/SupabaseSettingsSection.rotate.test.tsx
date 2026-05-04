import "../../../../tests/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseSettingsSection } from "@/components/settings/SupabaseSettingsSection";
import { configView } from "../../../../tests/setupFixtures";

const originalFetch = globalThis.fetch;

describe("SupabaseSettingsSection rotate", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("opens rotation entry and posts surface ui", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    render(<SupabaseSettingsSection supabase={configView().supabase} />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate Management API token" }));
    fireEvent.change(screen.getByLabelText("supabase.management_token"), { target: { value: "sbp_new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rotated token" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/settings/supabase/rotate", expect.objectContaining({
      body: JSON.stringify({ token: "sbp_new", surface: "ui" }),
    })));
  });

  it("shows redacted provider failure with previous-token hint", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: false, message: "Invalid token sbp_[redacted]" }, { status: 400 })) as unknown as typeof fetch;
    render(<SupabaseSettingsSection supabase={configView().supabase} />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate Management API token" }));
    fireEvent.change(screen.getByLabelText("supabase.management_token"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rotated token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid token sbp_[redacted] Previous token remains active.");
  });
});
