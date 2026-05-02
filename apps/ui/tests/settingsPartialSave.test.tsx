import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppConfigSection } from "@/components/settings/AppConfigSection";
import { configView } from "./setupFixtures";

const partial = {
  ok: false,
  saved: ["publicBaseUrl"],
  rejected: [{ field: "enginePort", error: "enginePort must be an integer between 1 and 65535" }],
  config: { enginePort: 4100 },
};

describe("Partial save feedback", () => {
  it("AC-9 names that only part of the settings was saved", async () => {
    globalThis.fetch = vi.fn(async () => Response.json(partial, { status: 207 })) as unknown as typeof fetch;
    render(<AppConfigSection initialView={configView()} />);
    fireEvent.click(screen.getByRole("button", { name: /save app config/i }));
    await screen.findByText(/Partial save/i);
  });

  it("AC-10 keeps rejected fields visible with field-near errors", async () => {
    globalThis.fetch = vi.fn(async () => Response.json(partial, { status: 207 })) as unknown as typeof fetch;
    render(<AppConfigSection initialView={configView()} />);
    fireEvent.change(screen.getByLabelText(/Engine port/i), { target: { value: "99999" } });
    fireEvent.click(screen.getByRole("button", { name: /save app config/i }));
    await screen.findByText(/between 1 and 65535/i);
  });

  it("AC-11 does not mark saved fields as failed", async () => {
    globalThis.fetch = vi.fn(async () => Response.json(partial, { status: 207 })) as unknown as typeof fetch;
    render(<AppConfigSection initialView={configView()} />);
    fireEvent.click(screen.getByRole("button", { name: /save app config/i }));
    await waitFor(() => expect(screen.getByText(/Saved: publicBaseUrl/i)).toBeInTheDocument());
  });

  it("AC-12 preserves rejected input context", async () => {
    globalThis.fetch = vi.fn(async () => Response.json(partial, { status: 207 })) as unknown as typeof fetch;
    render(<AppConfigSection initialView={configView()} />);
    fireEvent.change(screen.getByLabelText(/Engine port/i), { target: { value: "99999" } });
    fireEvent.click(screen.getByRole("button", { name: /save app config/i }));
    await waitFor(() => expect(screen.getByLabelText(/Engine port/i)).toHaveValue("99999"));
  });
});
