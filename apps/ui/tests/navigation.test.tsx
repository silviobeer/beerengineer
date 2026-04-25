import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ItemCard } from "@/components/ItemCard";
import { makeItem } from "@/lib/fixtures";

describe("ItemCard navigation contract (TC-11 unit fallback)", () => {
  it("renders an anchor whose href points at /w/[key]/items/[id]", () => {
    render(
      <ItemCard
        item={makeItem({ id: "abc-42" })}
        workspaceKey="demo"
      />
    );
    const card = screen.getByTestId("item-card");
    expect(card.tagName.toLowerCase()).toBe("a");
    expect(card.getAttribute("href")).toBe("/w/demo/items/abc-42");
  });
});
