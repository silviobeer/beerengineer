/**
 * Shared tuning knobs for the event-bus transport.
 *
 * `LOG_TAIL_INTERVAL_MS` is the cadence at which any process (API server,
 * CLI, tests) polls `stage_logs` as the cross-process bus. Keep this in
 * one place so `/runs/:id/events`, `/events` (workspace board), and the
 * CLI cross-process bridge all move in lockstep.
 */
export const LOG_TAIL_INTERVAL_MS = 250

/**
 * Window after a `prompt_requested` chattool notification during which a
 * second prompt on the same run is suppressed as a duplicate. After the
 * window passes the dedup row is re-claimable and a follow-up prompt
 * re-notifies the operator. Spec reference: `telegram-refactor.md` §4.
 */
export const CHATTOOL_PROMPT_RENOTIFY_WINDOW_MS = 45_000

/**
 * Upper bound on how many `stage_logs` rows `/runs/:id/messages` scans in
 * one request before giving up and asking the client to paginate. Guards
 * against pathological "all rows filtered out" loops on noisy L0 runs when
 * the caller requests L2.
 */
export const MESSAGES_ENDPOINT_MAX_SCAN = 5_000

