import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  MANAGED_INSTALL_POSIX_COMMAND,
  MANAGED_INSTALL_PREREQUISITES,
  MANAGED_INSTALL_WINDOWS_COMMAND,
} from "../src/core/managedInstall/docs.js"

const DOC_PATHS = [
  "README.md",
  "apps/engine/docs/app-setup.md",
  "apps/engine/docs/setup-for-dummies.md",
]

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

test("install docs contain drift-checked POSIX and Windows commands", () => {
  for (const path of DOC_PATHS) {
    const doc = readFileSync(repoPath(path), "utf8")
    assert.match(doc, escapeRegex(MANAGED_INSTALL_POSIX_COMMAND), path)
    assert.match(doc, escapeRegex(MANAGED_INSTALL_WINDOWS_COMMAND), path)
  }
})

test("install docs mention prerequisites PATH behavior and no silent profile mutation", () => {
  for (const path of DOC_PATHS) {
    const doc = readFileSync(repoPath(path), "utf8")
    for (const prerequisite of MANAGED_INSTALL_PREREQUISITES) assert.match(doc, escapeRegex(prerequisite), path)
    assert.match(doc, /PATH/, path)
    assert.match(doc, /does not edit shell profiles|never mutates[\s\S]*profiles|does not silently install/, path)
  }
})

test("install docs document no v1 uninstall command and manual removal scope", () => {
  for (const path of DOC_PATHS) {
    const doc = readFileSync(repoPath(path), "utf8")
    assert.match(doc, /v1[\s\S]*(no uninstall command|no .*uninstall)/i, path)
    assert.match(doc, /manual (removal|cleanup)/i, path)
    assert.match(doc, /config file/i, path)
    assert.match(doc, /SQLite database/i, path)
    assert.match(doc, /managed\s+install\s+root/i, path)
  }
})

function escapeRegex(input: string): RegExp {
  return new RegExp(input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
}

function repoPath(path: string): string {
  return resolve(REPO_ROOT, path)
}
