import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

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

function formatRouteSurfaceDiff(diff: RouteSurfaceDiff): string {
  const sections = ["API route surface parity failed."]
  if (diff.implementedOnly.length > 0) {
    sections.push(`Implemented only:\n${diff.implementedOnly.map(route => `  - ${route}`).join("\n")}`)
  }
  if (diff.documentedOnly.length > 0) {
    sections.push(`Documented only:\n${diff.documentedOnly.map(route => `  - ${route}`).join("\n")}`)
  }
  return sections.join("\n\n")
}

function assertRouteSurfaceParity(implemented: string[], documented: string[]): void {
  const diff = diffRouteSurface(implemented, documented)
  if (diff.implementedOnly.length === 0 && diff.documentedOnly.length === 0) return
  assert.fail(formatRouteSurfaceDiff(diff))
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
    /Implemented only:\n  - POST \/drift-only/,
  )
})

test("REQ-1 parity gate reports documented-only route drift", () => {
  const implemented = listImplementedApiRouteSurface()
  const documented = [...readDocumentedApiRouteSurface(loadOpenApiDocument()), "GET /documented-only"].sort(compareRoutes)

  assert.throws(
    () => assertRouteSurfaceParity(implemented, documented),
    /Documented only:\n  - GET \/documented-only/,
  )
})

test("REQ-1 parity gate treats a rename as two mismatches", () => {
  const implemented = listImplementedApiRouteSurface().map(route => route === "GET /health" ? "GET /healthz" : route).sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())

  assert.throws(
    () => assertRouteSurfaceParity(implemented, documented),
    /Implemented only:\n  - GET \/healthz[\s\S]*Documented only:\n  - GET \/health/,
  )
})

test("REQ-1 parity gate fails on method-only drift for the same path", () => {
  const implemented = listImplementedApiRouteSurface().map(route => route === "GET /health" ? "POST /health" : route).sort(compareRoutes)
  const documented = readDocumentedApiRouteSurface(loadOpenApiDocument())

  assert.throws(
    () => assertRouteSurfaceParity(implemented, documented),
    /Implemented only:\n  - POST \/health[\s\S]*Documented only:\n  - GET \/health/,
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
    assert.match(String(err), /Implemented only:/)
    assert.match(String(err), /POST \/implemented-only/)
    assert.match(String(err), /Documented only:/)
    assert.match(String(err), /GET \/documented-only/)
    return true
  })
})
