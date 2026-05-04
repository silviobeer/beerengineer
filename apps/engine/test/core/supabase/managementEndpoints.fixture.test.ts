import { test } from "node:test"
import assert from "node:assert/strict"

import { managementEndpoints } from "../../../src/core/supabase/managementEndpoints.js"

test("PROJ-4 PRD-2 US-1: management endpoint constants pin v1 paths", () => {
  assert.equal(managementEndpoints.listProjects, "/projects")
  assert.equal(managementEndpoints.getProject("proj_ref"), "/projects/proj_ref")
  assert.equal(managementEndpoints.listBranches("proj_ref"), "/projects/proj_ref/branches")
  assert.equal(managementEndpoints.createBranch("proj_ref"), "/projects/proj_ref/branches")
  assert.equal(managementEndpoints.getBranch("proj_ref", "br_1"), "/projects/proj_ref/branches/br_1")
  assert.equal(managementEndpoints.deleteBranch("proj_ref", "br_1"), "/projects/proj_ref/branches/br_1")
  assert.equal(managementEndpoints.runQuery("proj_ref", "br_1"), "/projects/proj_ref/branches/br_1/query")
  assert.equal(managementEndpoints.createAuthAdminUser("proj_ref", "br_1"), "/projects/proj_ref/branches/br_1/auth/users")
})

