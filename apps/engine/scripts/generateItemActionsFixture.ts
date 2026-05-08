import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildAllowedItemActionsByState,
  diffAllowedItemActionsByState,
  serializeAllowedItemActionsByState,
  type AllowedItemActionsByState,
} from "../src/core/itemActionFixture.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")
const fixturePath = resolve(repoRoot, "apps", "ui", "tests", "fixtures", "item-actions-allowed.json")

function readCommittedFixture(): AllowedItemActionsByState {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as AllowedItemActionsByState
}

const generated = buildAllowedItemActionsByState()

if (process.argv.includes("--check")) {
  const committed = readCommittedFixture()
  const drift = diffAllowedItemActionsByState(committed, generated)
  if (drift) {
    console.error(drift)
    process.exit(1)
  }
  console.log("Committed allowed-actions fixture matches generated engine-side action data.")
  process.exit(0)
}

mkdirSync(dirname(fixturePath), { recursive: true })
writeFileSync(fixturePath, serializeAllowedItemActionsByState(generated))
console.log(`Wrote ${fixturePath}`)
