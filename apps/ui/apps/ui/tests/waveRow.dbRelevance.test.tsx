import "../../../tests/setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaveRow } from "@/components/WaveRow";

describe("WaveRow db relevance", () => {
  it("renders DB chip and source tooltip", () => {
    render(<WaveRow title="Wave 1" dbRelevance={{ value: true, source: "explicit", reason: "schema" }} />);
    expect(screen.getByText("DB")).toBeInTheDocument();
    expect(screen.getByLabelText(/explicit: schema/)).toBeInTheDocument();
  });

  it("renders non-DB chip", () => {
    render(<WaveRow title="Wave 2" dbRelevance={{ value: false, source: "override", reason: "docs-only" }} />);
    expect(screen.getByText("non-DB")).toBeInTheDocument();
    expect(screen.getByLabelText(/override: docs-only/)).toBeInTheDocument();
  });
});
