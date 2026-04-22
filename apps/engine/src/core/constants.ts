/**
 * Shared tuning knobs for the event-bus transport.
 *
 * `LOG_TAIL_INTERVAL_MS` is the cadence at which any process (API server,
 * CLI, tests) polls `stage_logs` as the cross-process bus. Keep this in
 * one place so `/runs/:id/events`, `/events` (workspace board), and the
 * CLI cross-process bridge all move in lockstep.
 */
export const LOG_TAIL_INTERVAL_MS = 250
