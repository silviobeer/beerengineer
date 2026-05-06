import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { verifySetupContract } from "../src/stages/execution/setupContractVerifier.js"

function withWorkspace(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "be2-setup-contract-"))
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("setup contract accepts npm lifecycle commands as required package scripts", () => {
  withWorkspace(root => {
    mkdirSync(join(root, "src"))
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: {
          start: "node src/index.js",
          test: "node --test",
        },
      }),
    )
    writeFileSync(join(root, ".gitignore"), "node_modules/\n")
    writeFileSync(join(root, "src", "index.js"), "console.log('Hello, World!')\n")

    const failures = verifySetupContract(root, {
      expectedFiles: ["package.json", ".gitignore", "src/"],
      requiredScripts: ["npm test", "npm start"],
      postChecks: [],
    })

    assert.deepEqual(failures, [])
  })
})

test("setup contract still accepts bare package script names", () => {
  withWorkspace(root => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "test:unit": "node --test",
        },
      }),
    )

    const failures = verifySetupContract(root, {
      expectedFiles: [],
      requiredScripts: ["test:unit"],
      postChecks: [],
    })

    assert.deepEqual(failures, [])
  })
})
