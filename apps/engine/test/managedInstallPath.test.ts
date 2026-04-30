import { test } from "node:test"
import assert from "node:assert/strict"

import {
  detectManagedWrapperShadow,
  pathContainsDirectory,
} from "../src/core/managedInstall/pathCheck.js"

test("pathContainsDirectory detects wrapper bin directory by platform delimiter", () => {
  assert.equal(pathContainsDirectory("/opt/beer/bin:/usr/bin", "/opt/beer/bin", ":"), true)
  assert.equal(pathContainsDirectory("/usr/bin:/bin", "/opt/beer/bin", ":"), false)
  assert.equal(pathContainsDirectory("C:\\beer\\bin;C:\\Windows", "C:\\beer\\bin", ";"), true)
})

test("detectManagedWrapperShadow reports global command shadowing without removal", () => {
  const result = detectManagedWrapperShadow({
    wrapperPath: "/home/user/.local/share/beerengineer/bin/beerengineer",
    pathEnv: "/usr/local/bin:/home/user/.local/share/beerengineer/bin",
    resolvedCommandPath: "/usr/local/bin/beerengineer",
    delimiter: ":",
  })

  assert.equal(result.shadowed, true)
  assert.equal(result.wrapperDirOnPath, true)
  assert.match(result.warning ?? "", /\/usr\/local\/bin\/beerengineer/)
  assert.match(result.warning ?? "", /\/home\/user\/\.local\/share\/beerengineer\/bin\/beerengineer/)
  assert.match(result.fixHint, /PATH order/)
  assert.match(result.fixHint, /manually remove/)
  assert.equal(result.shouldRemoveGlobalInstall, false)
})

test("detectManagedWrapperShadow gives PATH instruction when wrapper bin is absent", () => {
  const result = detectManagedWrapperShadow({
    wrapperPath: "/home/user/.local/share/beerengineer/bin/beerengineer",
    pathEnv: "/usr/local/bin:/usr/bin",
    resolvedCommandPath: null,
    delimiter: ":",
  })

  assert.equal(result.shadowed, false)
  assert.equal(result.wrapperDirOnPath, false)
  assert.match(result.pathInstruction ?? "", /Add \/home\/user\/\.local\/share\/beerengineer\/bin to PATH/)
})
