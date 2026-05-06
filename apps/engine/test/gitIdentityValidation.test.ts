import assert from "node:assert/strict"
import { test } from "node:test"

import {
  GIT_IDENTITY_ERROR_CODES,
  validateGitIdentityInput,
} from "../src/setup/gitIdentity.js"

test("AC-15 shared validator exposes one error vocabulary", () => {
  assert.deepEqual(GIT_IDENTITY_ERROR_CODES, [
    "git_not_installed",
    "identity_missing",
    "identity_invalid",
    "workspace_not_found",
    "workspace_not_git_repo",
    "workspace_path_unavailable",
    "repair_partial_failure",
    "commit_signing_blocked",
  ])
})

test("AC-16 validator accepts structurally valid local@domain email forms", () => {
  const result = validateGitIdentityInput({ displayName: "Local User", email: "local@example.test" })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.identity.email, "local@example.test")
    assert.equal(result.identity.localOnly, false)
  }
})

test("AC-17 validator recognizes @local.beerengineer placeholders as local-only", () => {
  const result = validateGitIdentityInput({ displayName: "Private User", email: "private@local.beerengineer" })

  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.identity.localOnly, true)
})

test("AC-18 validator recognizes GitHub noreply forms as publishable", () => {
  const result = validateGitIdentityInput({ displayName: "Hub User", email: "12345+hubber@users.noreply.github.com" })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.identity.emailKind, "github-noreply")
    assert.equal(result.identity.localOnly, false)
  }
})

test("AC-19 validator returns field-specific errors for invalid identity input", () => {
  const result = validateGitIdentityInput({ displayName: " ", email: "not-an-email" })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.deepEqual(result.errors.map(error => error.field).sort(), ["displayName", "email"])
    assert.equal(result.error, "identity_invalid")
  }
})
