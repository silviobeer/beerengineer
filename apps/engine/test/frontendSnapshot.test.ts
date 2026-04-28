import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { loadFrontendSnapshot } from "../src/core/frontendSnapshot.js"

test("loadFrontendSnapshot inventories frontend trees in sorted order", () => {
  const dir = mkdtempSync(join(tmpdir(), "be2-frontend-snapshot-"))
  try {
    mkdirSync(join(dir, "apps", "ui", "components", "zeta"), { recursive: true })
    mkdirSync(join(dir, "apps", "ui", "components", "alpha"), { recursive: true })
    writeFileSync(
      join(dir, "apps", "ui", "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }, null, 2),
      "utf8",
    )
    writeFileSync(join(dir, "apps", "ui", "components", "zeta", "Widget.tsx"), "export const Widget = null\n", "utf8")
    writeFileSync(join(dir, "apps", "ui", "components", "alpha", "Button.tsx"), "export const Button = null\n", "utf8")

    const snapshot = loadFrontendSnapshot(dir)
    assert.ok(snapshot)
    assert.equal(snapshot?.framework, "next")
    assert.deepEqual(
      snapshot?.componentTree.slice(0, 5),
      [
        "apps/ui/components/",
        "apps/ui/components/alpha/",
        "apps/ui/components/alpha/Button.tsx",
        "apps/ui/components/zeta/",
        "apps/ui/components/zeta/Widget.tsx",
      ],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
