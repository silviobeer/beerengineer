/**
 * Parse the `data_json` column on `stage_logs`. Returns `undefined` when the
 * column is null/empty or not valid JSON so callers can fall through to
 * explicit field defaults.
 */
export function parseLogData(dataJson) {
    if (!dataJson)
        return undefined;
    try {
        return JSON.parse(dataJson);
    }
    catch {
        return undefined;
    }
}
