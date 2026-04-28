export function json(res, status, body) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}
export async function readJson(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw)
        return {};
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
/**
 * Echo only the approved UI origin. `*` combined with a DELETE route that
 * does rm -rf would let any page on the user's browser delete workspaces.
 */
export function setCors(res, req, allowedOrigin) {
    const origin = req.headers.origin;
    if (origin === allowedOrigin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "origin");
        res.setHeader("access-control-allow-credentials", "true");
    }
    res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-beerengineer-token");
}
const MUTATING_METHODS = new Set(["POST", "DELETE", "PUT", "PATCH"]);
export function requireCsrfToken(req, token) {
    if (!MUTATING_METHODS.has(req.method ?? ""))
        return true;
    const header = req.headers["x-beerengineer-token"];
    const value = Array.isArray(header) ? header[0] : header;
    return typeof value === "string" && value === token;
}
export function writeSse(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
export { parseLogData } from "../core/jsonEnvelope.js";
