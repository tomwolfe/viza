type MessageHandler = (event: MessageEvent) => void;
type ErrorHandler = (event: Event) => void;

export class MockWorker {
  private listeners: Map<string, MessageHandler[]> = new Map();
  private messageQueue: MessageEvent[] = [];
  private errorHandler: ErrorHandler | null = null;
  private onErrorFn: ((msg: string) => void) | null = null;

  constructor() {
    this.postMessage = this.postMessage.bind(this);
  }

  postMessage = (data: unknown) => {
    const event = new MessageEvent('message', { data });
    setTimeout(() => {
      this.handleMessage(event);
    }, 50);
  };

  addEventListener(type: string, handler: MessageHandler) {
    if (type === 'message') {
      const existing = this.listeners.get(type) || [];
      existing.push(handler);
      this.listeners.set(type, existing);
    }
  }

  removeEventListener(type: string, handler: MessageHandler) {
    if (type === 'message') {
      const existing = this.listeners.get(type) || [];
      const filtered = existing.filter((h) => h !== handler);
      this.listeners.set(type, filtered);
    }
  }

  onerror: ErrorHandler | null = null;

  private handleMessage(event: MessageEvent) {
    const handlers = this.listeners.get('message') || [];
    handlers.forEach((handler) => handler(event));
  }

  triggerMessage(data: unknown) {
    const event = new MessageEvent('message', { data });
    this.handleMessage(event);
  }

  triggerError(message: string) {
    if (this.onerror) {
      this.onerror(new Event(message));
    }
  }
}

export function createMockWorker(): MockWorker {
  return new MockWorker();
}