import { test } from "node:test"
import assert from "node:assert/strict"

import { listImplementedApiRouteSurface } from "../../../src/api/routeRegistration.js"

test("PROJ-4 PRD-2 US-1: engine exposes a setup Supabase connect route", () => {
  assert.ok(listImplementedApiRouteSurface().includes("POST /setup/supabase/connect"))
})
