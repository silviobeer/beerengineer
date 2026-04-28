import type { EventSourceLike } from "./types";

type Listener = (e: MessageEvent) => void;

export class MockEventSource implements EventSourceLike {
  static readonly instances: MockEventSource[] = [];
  private static _constructorCount = 0;

  url: string;
  closed = false;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource._constructorCount += 1;
    MockEventSource.instances.push(this);
  }

  static get constructorCount(): number {
    return MockEventSource._constructorCount;
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  // Test helpers
  simulateEvent(type: string, data: unknown): void {
    if (this.closed) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const event = new MessageEvent(type, { data: payload });
    const set = this.listeners.get(type);
    if (set) {
      for (const listener of set) listener(event);
    }
    if (type === "message" && this.onmessage) {
      this.onmessage(event);
    }
  }

  simulateMessage(data: unknown): void {
    this.simulateEvent("message", data);
  }

  simulateError(): void {
    this.closed = true;
    const event = new Event("error");
    if (this.onerror) this.onerror(event);
  }

  simulateClose(): void {
    this.closed = true;
    const event = new Event("close");
    if (this.onclose) {
      this.onclose(event);
    } else if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  static reset(): void {
    MockEventSource.instances.length = 0;
    MockEventSource._constructorCount = 0;
  }
}

export function makeMockEventSourceFactory() {
  MockEventSource.reset();
  return (url: string) => new MockEventSource(url);
}
