import type { ChatMessage } from "../../types.js"
import type { HostedSession } from "../providerRuntime.js"

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
export function readReplayMessages(session: HostedSession | null | undefined): ChatMessage[] {
  return session?.messages ? [...session.messages] : []
}

export function appendReplayMessages(
  session: HostedSession | null | undefined,
  next: ChatMessage[],
): ChatMessage[] {
  const prior = readReplayMessages(session)
  return [...prior, ...next]
}

export function makeReplaySession(
  base: HostedSession,
  messages: ChatMessage[],
  sessionId: string | null = base.sessionId ?? null,
): HostedSession {
  return { harness: base.harness, sessionId, messages }
}
