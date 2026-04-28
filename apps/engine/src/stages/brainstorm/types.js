function stringifyArrayValue(value) {
    if (typeof value === "string")
        return value;
    if (value == null)
        return "";
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
        return String(value);
    const serialized = JSON.stringify(value);
    return serialized ?? "";
}
/**
 * Coerce a value that should be `string[]` to an actual `string[]`.
 *
 * The real LLM occasionally serialises array fields as a single string
 * (e.g. `"constraints": "Hard boundary: ...; ..."`). This function normalises
 * all four shapes before the artifact is persisted, so downstream code can
 * safely spread the array.
 *
 *   string[]              → unchanged
 *   string                → split on newline / bullet markers, or wrap as [value]
 *   null / undefined      → []
 *   non-string[]          → each element stringified
 */
export function coerceToStringArray(value) {
    if (Array.isArray(value))
        return value.map(stringifyArrayValue);
    if (value == null)
        return [];
    if (typeof value === "string") {
        const lines = value.split(/\r?\n/).map(s => s.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
        return lines.length > 0 ? lines : [value];
    }
    if (typeof value === "object") {
        return Object.values(value).map(stringifyArrayValue);
    }
    return typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" ? [String(value)] : [];
}
function normalizeConcept(c) {
    if (typeof c === "string" || c == null) {
        return {
            summary: typeof c === "string" ? c : "",
            problem: "",
            users: [],
            constraints: [],
        };
    }
    return { ...c, users: coerceToStringArray(c.users), constraints: coerceToStringArray(c.constraints) };
}
/**
 * Normalise a raw `BrainstormArtifact` that may contain string-typed array
 * fields (real-LLM serialisation drift). Returns a new object with
 * `constraints` and `users` guaranteed to be `string[]` on both the top-level
 * concept and every project concept.
 */
export function normalizeBrainstormArtifact(raw) {
    return {
        concept: normalizeConcept(raw.concept),
        projects: raw.projects.map(p => ({ ...p, concept: normalizeConcept(p.concept) })),
    };
}
