import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  validateManagedInstallArchiveEntries,
  validateManagedInstallReleaseSizes,
  validateManagedInstallReleaseTree,
} from "../src/core/managedInstall/validation.js"

test("validateManagedInstallArchiveEntries rejects traversal and absolute paths", () => {
  assert.throws(
    () => validateManagedInstallArchiveEntries(["beerengineer-1.0.0/package.json", "beerengineer-1.0.0/../evil.js"]),
    /managed_install_validate_failed:unsafe_archive_entry/,
  )
  assert.throws(
    () => validateManagedInstallArchiveEntries(["/tmp/evil.js"]),
    /managed_install_validate_failed:unsafe_archive_entry/,
  )
  assert.throws(
    () => validateManagedInstallArchiveEntries(["C:/tmp/evil.js"]),
    /managed_install_validate_failed:unsafe_archive_entry/,
  )
  assert.throws(
    () => validateManagedInstallArchiveEntries(["C:file.js"]),
    /managed_install_validate_failed:unsafe_archive_entry/,
  )
})

test("validateManagedInstallReleaseSizes enforces tarball and extracted-tree bounds", () => {
  validateManagedInstallReleaseSizes(
    { tarballBytes: 4, extractedBytes: 8 },
    { maxTarballBytes: 4, maxExtractedBytes: 8 },
  )
  assert.throws(
    () => validateManagedInstallReleaseSizes(
      { tarballBytes: 5, extractedBytes: 8 },
      { maxTarballBytes: 4, maxExtractedBytes: 8 },
    ),
    /managed_install_validate_failed:tarball_too_large:5:4/,
  )
  assert.throws(
    () => validateManagedInstallReleaseSizes(
      { tarballBytes: 4, extractedBytes: 9 },
      { maxTarballBytes: 4, maxExtractedBytes: 8 },
    ),
    /managed_install_validate_failed:extracted_tree_too_large:9:8/,
  )
})

test("validateManagedInstallReleaseTree accepts the expected monorepo shape", () => {
  const root = createValidReleaseTree()
  const result = validateManagedInstallReleaseTree(root, { tag: "v1.0.0", version: "1.0.0" })

  assert.equal(result.binPath, join(root, "apps", "engine", "bin", "beerengineer.js"))
})

test("validateManagedInstallReleaseTree rejects missing and inconsistent package metadata", () => {
  assert.throws(
    () => validateManagedInstallReleaseTree(mkdtempSync(join(tmpdir(), "managed-install-empty-")), { tag: "v1.0.0", version: "1.0.0" }),
    /managed_install_validate_failed:missing_root_package_json/,
  )

  const missingWorkspace = createValidReleaseTree({ workspaces: ["apps/engine"] })
  assert.throws(
    () => validateManagedInstallReleaseTree(missingWorkspace, { tag: "v1.0.0", version: "1.0.0" }),
    /managed_install_validate_failed:missing_workspace_apps_ui/,
  )

  const missingBin = createValidReleaseTree({ enginePackage: { name: "@beerengineer/engine", version: "1.0.0" } })
  assert.throws(
    () => validateManagedInstallReleaseTree(missingBin, { tag: "v1.0.0", version: "1.0.0" }),
    /managed_install_validate_failed:missing_engine_bin/,
  )

  const mismatchedVersion = createValidReleaseTree({ enginePackage: { name: "@beerengineer/engine", version: "2.0.0", bin: { beerengineer: "./bin/beerengineer.js" } } })
  assert.throws(
    () => validateManagedInstallReleaseTree(mismatchedVersion, { tag: "v1.0.0", version: "1.0.0" }),
    /managed_install_validate_failed:tag_version_mismatch:v1.0.0:2.0.0/,
  )

  const escapingBin = createValidReleaseTree({ enginePackage: { name: "@beerengineer/engine", version: "1.0.0", bin: { beerengineer: "../outside.js" } } })
  writeFileSync(join(escapingBin, "apps", "outside.js"), "#!/usr/bin/env node\n", "utf8")
  assert.throws(
    () => validateManagedInstallReleaseTree(escapingBin, { tag: "v1.0.0", version: "1.0.0" }),
    /managed_install_validate_failed:engine_bin_missing/,
  )
})

function createValidReleaseTree(overrides: {
  workspaces?: string[]
  enginePackage?: Record<string, unknown>
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), "managed-install-release-"))
  mkdirSync(join(root, "apps", "engine", "bin"), { recursive: true })
  mkdirSync(join(root, "apps", "ui"), { recursive: true })
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "beerengineer",
    private: true,
    workspaces: overrides.workspaces ?? ["apps/*"],
  })}\n`, "utf8")
  writeFileSync(join(root, "apps", "engine", "package.json"), `${JSON.stringify(overrides.enginePackage ?? {
    name: "@beerengineer/engine",
    version: "1.0.0",
    bin: { beerengineer: "./bin/beerengineer.js" },
  })}\n`, "utf8")
  writeFileSync(join(root, "apps", "engine", "bin", "beerengineer.js"), "#!/usr/bin/env node\n", "utf8")
  return root
}
