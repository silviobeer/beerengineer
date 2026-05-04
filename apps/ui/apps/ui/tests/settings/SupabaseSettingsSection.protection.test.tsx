import "../../../../tests/setup";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseSettingsSection } from "@/components/settings/SupabaseSettingsSection";
import { configView } from "../../../../tests/setupFixtures";

const originalFetch = globalThis.fetch;

describe("SupabaseSettingsSection protection", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requires confirmation before enabling and saves off immediately", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true, supabase: { productionMigrationProtection: "on", settingsVersion: 2 } }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    render(<SupabaseSettingsSection supabase={configView().supabase} />);
    fireEvent.click(screen.getByLabelText("Production migration protection"));
    expect(screen.getByText(/Merge will apply migrations/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm enable" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/settings/supabase", expect.objectContaining({
      body: expect.stringContaining("\"confirmed\":true"),
    })));
  });
});
