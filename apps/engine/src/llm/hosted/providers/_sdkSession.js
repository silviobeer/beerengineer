/**
 * History-replay helper for SDK runtimes.
 *
 * Some agent SDKs expose a server-side conversation handle (analogous to the
 * CLI's `--resume <id>`). When that exists, the SDK adapter passes it through
 * `HostedSession.sessionId` and ignores this helper.
 *
 * Otherwise the adapter persists the local message history per stage instance
 * via `HostedSession.messages` and replays it on each step. The cost is
 * bandwidth, not correctness, since stage payloads (`stageContext`,
 * `reviewContext`, `iterationContext`) already carry the authoritative state.
 */
export function readReplayMessages(session) {
    return session?.messages ? [...session.messages] : [];
}
export function appendReplayMessages(session, next) {
    const prior = readReplayMessages(session);
    return [...prior, ...next];
}
export function makeReplaySession(base, messages, sessionId = base.sessionId ?? null) {
    return { harness: base.harness, sessionId, messages };
}
