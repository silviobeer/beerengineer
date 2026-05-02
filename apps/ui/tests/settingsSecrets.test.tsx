import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecretMaintenanceRow } from "@/components/settings/SecretMaintenanceRow";

const originalFetch = globalThis.fetch;

describe("SecretMaintenanceRow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("AC-13 shows metadata without cleartext values", () => {
    render(
      <SecretMaintenanceRow
        label="LLM API key"
        secret={{ ref: "ANTHROPIC_API_KEY", present: true, value: "sk-live-secret" } as never}
        fallbackRef="ANTHROPIC_API_KEY"
      />,
    );
    expect(screen.getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    expect(screen.queryByText("sk-live-secret")).not.toBeInTheDocument();
    expect(screen.queryByText(/^sk-/)).not.toBeInTheDocument();
  });

  it("AC-14 clears add or replace input after success", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ref: "ANTHROPIC_API_KEY", status: "active", present: true })) as unknown as typeof fetch;
    render(<SecretMaintenanceRow label="LLM API key" secret={{ ref: "ANTHROPIC_API_KEY", present: false }} fallbackRef="ANTHROPIC_API_KEY" />);
    const input = screen.getByLabelText(/Add or replace value/i);
    fireEvent.change(input, { target: { value: "sk-live-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("AC-15 lifecycle actions update visible secret status", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ref: "ANTHROPIC_API_KEY", status: "disabled", present: true })) as unknown as typeof fetch;
    render(<SecretMaintenanceRow label="LLM API key" secret={{ ref: "ANTHROPIC_API_KEY", present: true }} fallbackRef="ANTHROPIC_API_KEY" />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(screen.getByTestId("status-chip")).toHaveAttribute("data-state", "disabled"));
  });

  it("preserves known presence when secret action responses are partial", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ref: "ANTHROPIC_API_KEY", status: "disabled" })) as unknown as typeof fetch;
    render(<SecretMaintenanceRow label="LLM API key" secret={{ ref: "ANTHROPIC_API_KEY", present: true }} fallbackRef="ANTHROPIC_API_KEY" />);
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(screen.getByTestId("status-chip")).toHaveAttribute("data-state", "disabled"));
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled();
  });

  it("AC-16 keeps missing optional secrets visible as not configured or skipped", () => {
    render(<SecretMaintenanceRow label="Telegram bot token" secret={{ ref: "TELEGRAM_BOT_TOKEN", present: false }} fallbackRef="TELEGRAM_BOT_TOKEN" />);
    expect(screen.getByText("TELEGRAM_BOT_TOKEN")).toBeInTheDocument();
    expect(screen.getByTestId("status-chip")).toHaveTextContent(/blocked|missing|unknown/i);
  });
});
