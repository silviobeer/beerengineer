type Listener = (ev: MessageEvent | Event) => void;

export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  private listeners = new Map<string, Set<Listener>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload: unknown) {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    const ev = new MessageEvent(type, { data });
    this.listeners.get(type)?.forEach((l) => l(ev));
  }
  emitError() {
    const ev = new Event("error");
    this.listeners.get("error")?.forEach((l) => l(ev));
  }
  static reset() {
    MockEventSource.instances = [];
  }
  static last(): MockEventSource | undefined {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

export function makeMockEventSourceFactory() {
  return (url: string): EventSource =>
    new MockEventSource(url) as unknown as EventSource;
}
