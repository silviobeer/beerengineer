import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { buildHealthResponse } from "../src/api/health.js"
import { listImplementedApiRouteSurface } from "../src/api/routeRegistration.js"

type OpenApiDocument = {
  paths: Record<string, Record<string, unknown>>
}

type RouteSurfaceDiff = {
  implementedOnly: string[]
  documentedOnly: string[]
}

const HTTP_METHODS = new Set(["get", "post", "patch", "put", "delete", "options", "head"])

function compareRoutes(left: string, right: string): number {
  return left.localeCompare(right)
}

function loadOpenApiDocument(): OpenApiDocument {
  return JSON.parse(readFileSync(new URL("../src/api/openapi.json", import.meta.url), "utf8")) as OpenApiDocument
}

function readDocumentedApiRouteSurface(document: OpenApiDocument): string[] {
  const routes: string[] = []
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const method of Object.keys(operations)) {
      if (!HTTP_METHODS.has(method)) continue
      routes.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return routes.sort(compareRoutes)
}

function diffRouteSurface(implemented: string[], documented: string[]): RouteSurfaceDiff {
  const implementedSet = new Set(implemented)
  const documentedSet = new Set(documented)
  return {
    implementedOnly: implemented.filter(route => !documentedSet.has(route)),
    documentedOnly: documented.filter(route => !implementedSet.has(route)),
  }
}

function formatRouteList(routes: string[]): string {
  return routes.map(route => `  - ${route}`).join("\n")
}

function formatRouteSurfaceDiff(diff: RouteSurfaceDiff): string {
  const sections = [
    "API route surface parity failed.",
    "Compared implemented route registration with apps/engine/src/api/openapi.json.",
    `Summary: ${diff.implementedOnly.length} implemented route(s) missing from OpenAPI; ${diff.documentedOnly.length} documented route(s) missing from the implementation.`,
  ]
  if (diff.implementedOnly.length > 0) {
    sections.push(`Implemented routes missing from apps/engine/src/api/openapi.json:\n${formatRouteList(diff.implementedOnly)}`)
  }
  if (diff.documentedOnly.length > 0) {
    sections.push(`Documented routes missing from the implementation:\n${formatRouteList(diff.documentedOnly)}`)
  }
  return sections.join("\n\n")
}

function assertRouteSurfaceParity(implemented: string[], documented: string[]): void {
  const diff = diffRouteSurface(implemented, documented)
  if (diff.implementedOnly.length === 0 && diff.documentedOnly.length === 0) return
  assert.fail(formatRouteSurfaceDiff(diff))
}

function captureRouteSurfaceParityFailure(implemented: string[], documented: string[]): Error {
  try {
    assertRouteSurfaceParity(implemented, documented)
  } catch (error) {
    return error as Error
  }
  throw new Error("expected route surface parity failure")
}

test("REQ-1 parity gate passes when implemented and documented method+path pairs match", () => {
  const implemented = listImplementedApiRouteSurface()
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())

  assertRouteSurfaceParity(implemented, documented)
})

test("REQ-1 parity gate reports implemented-only route drift", () => {
  const implemented = [...listImplementedApiRouteSurface(), "POST /drift-only"].sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())

  assert.throws(
    () => assertRouteSurfaceParity(implemented, documented),
    /Implemented routes missing from apps\/engine\/src\/api\/openapi\.json:\n  - POST \/drift-only/,
  )
})

test("REQ-1 parity gate reports documented-only route drift", () => {
  const implemented = listImplementedApiRouteSurface()
  const documented = [...readDocumentedApiRouteSurface(loadOpenApiDocument()), "GET /documented-only"].sort(compareRoutes)

  assert.throws(
    () => assertRouteSurfaceParity(implemented, documented),
    /Documented routes missing from the implementation:\n  - GET \/documented-only/,
  )
})

test("REQ-1 parity gate treats a rename as two mismatches", () => {
  const implemented = listImplementedApiRouteSurface().map(route => route === "GET /health" ? "GET /healthz" : route).sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())

  assert.throws(
    () => assertRouteSurfaceParity(implemented, documented),
    /Implemented routes missing from apps\/engine\/src\/api\/openapi\.json:\n  - GET \/healthz[\s\S]*Documented routes missing from the implementation:\n  - GET \/health/,
  )
})

test("REQ-1 parity gate fails on method-only drift for the same path", () => {
  const implemented = listImplementedApiRouteSurface().map(route => route === "GET /health" ? "POST /health" : route).sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())

  assert.throws(
    () => assertRouteSurfaceParity(implemented, documented),
    /Implemented routes missing from apps\/engine\/src\/api\/openapi\.json:\n  - POST \/health[\s\S]*Documented routes missing from the implementation:\n  - GET \/health/,
  )
})

test("REQ-1 parity gate ignores non-surface OpenAPI changes", () => {
  const openapi = loadOpenApiDocument()
  const mutated = structuredClone(openapi)
  mutated.paths["/health"] = {
    ...mutated.paths["/health"],
    get: {
      summary: "Updated summary only",
      parameters: [{ name: "verbose", in: "query", schema: { type: "boolean" } }],
      responses: {
        "200": {
          description: "Modified without changing route surface",
        },
      },
    },
  }

  const implemented = listImplementedApiRouteSurface()
  const documented = readDocumentedApiRouteSurface(mutated)

  assertRouteSurfaceParity(implemented, documented)
})

test("REQ-1 parity gate reports the full diff when both sides drift", () => {
  const implemented = listImplementedApiRouteSurface()
    .filter(route => route !== "GET /health")
    .concat("POST /implemented-only")
    .sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())
    .filter(route => route !== "GET /ready")
    .concat("GET /documented-only")
    .sort(compareRoutes)

  assert.throws(() => assertRouteSurfaceParity(implemented, documented), err => {
    assert.match(String(err), /Summary: 2 implemented route\(s\) missing from OpenAPI; 2 documented route\(s\) missing from the implementation\./)
    assert.match(String(err), /Implemented routes missing from apps\/engine\/src\/api\/openapi\.json:/)
    assert.match(String(err), /POST \/implemented-only/)
    assert.match(String(err), /GET \/ready/)
    assert.match(String(err), /Documented routes missing from the implementation:/)
    assert.match(String(err), /GET \/documented-only/)
    assert.match(String(err), /GET \/health/)
    return true
  })
})

test("REQ-2 drift report separates implemented-only and documented-only mismatches", () => {
  const report = formatRouteSurfaceDiff({
    implementedOnly: ["GET /items/{id}", "POST /runs/{id}/resume"],
    documentedOnly: ["DELETE /items/{id}", "PATCH /runs/{id}/resume"],
  })
  const implementedSection = report.match(/Implemented routes missing from apps\/engine\/src\/api\/openapi\.json:\n([\s\S]*?)\n\nDocumented routes missing from the implementation:/)
  const documentedSection = report.match(/Documented routes missing from the implementation:\n([\s\S]*)$/)

  assert.ok(implementedSection)
  assert.ok(documentedSection)
  assert.match(report, /Implemented routes missing from apps\/engine\/src\/api\/openapi\.json:\n  - GET \/items\/\{id\}\n  - POST \/runs\/\{id\}\/resume/)
  assert.match(report, /Documented routes missing from the implementation:\n  - DELETE \/items\/\{id\}\n  - PATCH \/runs\/\{id\}\/resume/)
  assert.doesNotMatch(implementedSection[1], /DELETE \/items\/\{id\}|PATCH \/runs\/\{id\}\/resume/)
  assert.doesNotMatch(documentedSection[1], /GET \/items\/\{id\}|POST \/runs\/\{id\}\/resume/)
})

test("REQ-2 parity gate failure output includes exact method and path for every mismatch", () => {
  const implemented = listImplementedApiRouteSurface()
    .filter(route => route !== "GET /health" && route !== "GET /ready")
    .concat(["POST /runs/{id}", "PATCH /shared-path"])
    .sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())
    .filter(route => route !== "GET /board")
    .concat(["DELETE /shared-path", "GET /documented-only"])
    .sort(compareRoutes)

  assert.throws(() => assertRouteSurfaceParity(implemented, documented), err => {
    const message = String(err)
    assert.match(message, /POST \/runs\/\{id\}/)
    assert.match(message, /PATCH \/shared-path/)
    assert.match(message, /GET \/health/)
    assert.match(message, /GET \/ready/)
    assert.match(message, /DELETE \/shared-path/)
    assert.match(message, /GET \/documented-only/)
    return true
  })
})

test("REQ-2 parity gate reports every mismatch from both drift buckets in one run", () => {
  const implemented = listImplementedApiRouteSurface()
    .filter(route => route !== "GET /health" && route !== "GET /ready")
    .concat(["POST /implemented-only-a", "PUT /implemented-only-b"])
    .sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())
    .filter(route => route !== "GET /board" && route !== "GET /events")
    .concat(["DELETE /documented-only-a", "PATCH /documented-only-b"])
    .sort(compareRoutes)

  assert.throws(() => assertRouteSurfaceParity(implemented, documented), err => {
    const message = String(err)
    assert.match(message, /Summary: 4 implemented route\(s\) missing from OpenAPI; 4 documented route\(s\) missing from the implementation\./)
    assert.match(message, /POST \/implemented-only-a/)
    assert.match(message, /PUT \/implemented-only-b/)
    assert.match(message, /GET \/health/)
    assert.match(message, /GET \/ready/)
    assert.match(message, /DELETE \/documented-only-a/)
    assert.match(message, /PATCH \/documented-only-b/)
    assert.match(message, /GET \/board/)
    assert.match(message, /GET \/events/)
    return true
  })
})

test("REQ-2 parity drift appears in contributor gate output but not runtime health output", () => {
  const report = captureRouteSurfaceParityFailure(
    [...listImplementedApiRouteSurface(), "POST /drift-only"].sort(compareRoutes),
    readDocumentedApiRouteSurface(loadOpenApiDocument()),
  )

  assert.match(String(report), /POST \/drift-only/)

  const health = buildHealthResponse({ prepare: () => ({ get: () => ({ ok: 1 }) }) } as never)
  assert.deepEqual(Object.keys(health.body).sort(), ["db", "ok", "service", "uptimeMs"])
  assert.equal("parity" in health.body, false)
})

test("REQ-2 one-sided drift output stays clear when the opposite bucket is empty", () => {
  const implemented = [...listImplementedApiRouteSurface(), "POST /implemented-only"].sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())

  assert.throws(() => assertRouteSurfaceParity(implemented, documented), err => {
    const message = String(err)
    assert.match(message, /Summary: 1 implemented route\(s\) missing from OpenAPI; 0 documented route\(s\) missing from the implementation\./)
    assert.match(message, /Implemented routes missing from apps\/engine\/src\/api\/openapi\.json:\n  - POST \/implemented-only/)
    assert.doesNotMatch(message, /Documented routes missing from the implementation:\n  -/)
    return true
  })
})
