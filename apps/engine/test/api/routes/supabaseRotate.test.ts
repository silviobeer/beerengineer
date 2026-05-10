import { test } from "node:test"
import assert from "node:assert/strict"

import { listImplementedApiRouteSurface } from "../../../src/api/routeRegistration.js"

test("PROJ-4 PRD-3 US-5: engine exposes supabase token rotation route", () => {
  const surface = listImplementedApiRouteSurface()
  assert.ok(surface.includes("POST /setup/supabase/rotate"))
  assert.ok(surface.includes("POST /setup/supabase/disconnect"))
})
