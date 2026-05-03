import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfigSection } from "@/components/settings/AppConfigSection";
import { configView } from "./setupFixtures";

describe("AppConfigSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-5 shows in-scope app config fields", () => {
    render(<AppConfigSection initialView={configView()} />);
    expect(screen.getByLabelText(/Allowed roots/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Engine port/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/LLM provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/API key reference/i)).toBeInTheDocument();
  });

  it("AC-6 saves through the UI API proxy boundary", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true, saved: ["enginePort"], rejected: [], config: { enginePort: 4200 } }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<AppConfigSection initialView={configView()} />);
    fireEvent.click(screen.getByRole("button", { name: /save app config/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/settings/config", expect.objectContaining({ method: "PATCH" })));
  });

  it("AC-7 explains enginePort changes as future-start", () => {
    render(<AppConfigSection initialView={configView()} />);
    expect(screen.getByText(/next engine start/i)).toBeInTheDocument();
  });

  it("AC-8 refreshes visible values from the backend response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, saved: ["enginePort"], rejected: [], config: { enginePort: 4200 } })));
    render(<AppConfigSection initialView={configView()} />);
    fireEvent.click(screen.getByRole("button", { name: /save app config/i }));
    await waitFor(() => expect(screen.getByLabelText(/Engine port/i)).toHaveValue(4200));
  });
});
