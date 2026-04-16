'use client';

import type { VizaErrorCode, WorkerIncomingMessage } from '@/types/worker';

export type WorkerMessageType =
  | 'init'
  | 'chat'
  | 'planning'
  | 'category'
  | 'reload'
  | 'ping'
  | 'app_reset';

export interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  type: 'chat' | 'planning' | 'category';
}

export interface WorkerClientOptions {
  onReady?: () => void;
  onProgress?: (progress: number) => void;
  onComplete?: (messageId: string, response: unknown, completed?: boolean) => void;
  onPlanningComplete?: (messageId: string, response: unknown) => void;
  onError?: (message: string, code: VizaErrorCode, messageId?: string) => void;
  onWarning?: (message: string) => void;
  onPong?: () => void;
  onUnresponsive?: () => void;
  inferenceTimeoutMs?: number;
  planningTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

const DEFAULT_INFERENCE_TIMEOUT = 15000;
const DEFAULT_PLANNING_TIMEOUT = 30000;
const DEFAULT_HEARTBEAT_INTERVAL = 30000;
const DEFAULT_HEARTBEAT_TIMEOUT = 60000;

export class WorkerClient {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, PendingRequest<unknown>> = new Map();
  private isInitialized = false;
  private options: Required<WorkerClientOptions>;
  private messageHandlers: Map<string, (data: Record<string, unknown>) => void> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongTime = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private onReconnect: (() => void) | null = null;
  private isModelReadyState = false;

  constructor(options: WorkerClientOptions = {}) {
    this.options = {
      onReady: options.onReady ?? (() => {}),
      onProgress: options.onProgress ?? (() => {}),
      onComplete: options.onComplete ?? (() => {}),
      onPlanningComplete: options.onPlanningComplete ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onWarning: options.onWarning ?? (() => {}),
      onPong: options.onPong ?? (() => {}),
      onUnresponsive: options.onUnresponsive ?? (() => {}),
      inferenceTimeoutMs: options.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT,
      planningTimeoutMs: options.planningTimeoutMs ?? DEFAULT_PLANNING_TIMEOUT,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT,
    };
  }

  initialize(workerUrl: string): void {
    if (this.isInitialized) return;

    this.worker = new Worker(workerUrl, { type: 'module' });

    this.worker.onmessage = (event) => {
      this.handleMessage(event.data as WorkerIncomingMessage);
    };

    this.worker.onerror = (errorEvent) => {
      this.options.onError(
        `Worker error: ${errorEvent.message}`,
        'WORKER_CRASHED'
      );
      this.rejectAllPending('Worker crashed');
    };

    this.isInitialized = this.isInitialized || true;

    this.lastPongTime = Date.now();
  }

  startHeartbeat(onReconnect: () => void): void {
    this.onReconnect = onReconnect;
    this.lastPongTime = Date.now();
    this.reconnectAttempts = 0;

    this.heartbeatInterval = setInterval(() => {
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      
      if (timeSinceLastPong > this.options.heartbeatTimeoutMs) {
        this.handleUnresponsive();
        return;
      }
      
      this.ping();
    }, this.options.heartbeatIntervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private handleUnresponsive(): void {
    this.options.onUnresponsive();
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.options.onError('AI Engine recovery failed after 3 attempts', 'WORKER_INIT_FAILED');
      return;
    }

    this.reconnectAttempts++;
    this.terminate();
    this.isInitialized = false;
    
    setTimeout(() => {
      this.initialize(new URL('../worker/vision.worker.ts', import.meta.url).href);
      this.onReconnect?.();
    }, 1000);
  }

  setModelReady(ready: boolean): void {
    this.isModelReadyState = ready;
  }

  isModelReady(): boolean {
    return this.isModelReadyState;
  }

  private handleMessage(data: WorkerIncomingMessage): void {
    const { type } = data;

    switch (type) {
      case 'worker_ready':
        this.options.onReady();
        break;

      case 'init_progress':
        this.options.onProgress((data.progress as number) ?? 0);
        break;

      case 'init_complete':
        this.isModelReadyState = true;
        this.options.onProgress(100);
        break;

      case 'inference_complete': {
        const messageId = data.messageId as string;
        const pending = this.pendingRequests.get(messageId);
        
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(messageId);
          this.options.onComplete(messageId, data.response, data.completed as boolean | undefined);
          pending.resolve(data.response);
        }
        break;
      }

      case 'planning_complete': {
        const messageId = data.messageId as string;
        const pending = this.pendingRequests.get(messageId);
        
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(messageId);
          this.options.onPlanningComplete(messageId, data.response);
          pending.resolve(data.response);
        }
        break;
      }

      case 'error':
        this.options.onError(
          (data as { message?: string }).message ?? 'Unknown worker error',
          (data as { errorCode?: VizaErrorCode }).errorCode ?? 'WORKER_INIT_FAILED',
          (data as { messageId?: string }).messageId
        );
        break;

      case 'warning':
        this.options.onWarning((data.message as string) ?? 'Unknown warning');
        break;

      case 'pong':
        this.lastPongTime = Date.now();
        this.options.onPong();
        break;

      default:
        break;
    }
  }

  private createRequestId(): string {
    return crypto.randomUUID();
  }

  private createTimeout(type: 'chat' | 'planning' | 'category', messageId: string): ReturnType<typeof setTimeout> {
    const timeoutMs = type === 'planning' 
      ? this.options.planningTimeoutMs 
      : this.options.inferenceTimeoutMs;
    
    return setTimeout(() => {
      this.pendingRequests.delete(messageId);
      this.options.onError(
        `${type === 'planning' ? 'Planning' : type === 'category' ? 'Category' : 'Inference'} timeout after ${timeoutMs / 1000}s`,
        'INFERENCE_TIMEOUT',
        messageId
      );
    }, timeoutMs);
  }

  private rejectAllPending(reason: string): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
    });
    this.pendingRequests.clear();
  }

  sendMessage<T>(
    type: WorkerMessageType,
    payload: Record<string, unknown>,
    transfer?: Transferable[],
    signal?: AbortSignal
  ): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not initialized'));
    }

    if (signal?.aborted) {
      return Promise.reject(new Error('Request aborted'));
    }

    const messageId = this.createRequestId();
    const inferenceType = type === 'planning' ? 'planning' : type === 'category' ? 'category' : 'chat';

    return new Promise<T>((resolve, reject) => {
      const timeoutId = this.createTimeout(inferenceType, messageId);

      this.pendingRequests.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
        type: inferenceType,
      });

      const abortHandler = () => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(messageId);
        reject(new Error('Request aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      try {
        this.worker!.postMessage(
          { type, messageId, ...payload },
          transfer
        );
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(messageId);
        reject(err);
      }
    });
  }

  init(model: string, systemPrompt: string): Promise<void> {
    return this.sendMessage('init', { model, systemPrompt });
  }

  chat(image: ImageBitmap, prompt: string, messageId: string): Promise<unknown> {
    return this.sendMessage('chat', { image, prompt, messageId }, [image]);
  }

  planning(image: ImageBitmap, goal: string, messageId: string): Promise<unknown> {
    return this.sendMessage('planning', { image, goal, messageId }, [image]);
  }

  category(image: ImageBitmap, goal: string, messageId: string): Promise<unknown> {
    return this.sendMessage('category', { image, goal, messageId }, [image]);
  }

  ping(): void {
    this.worker?.postMessage({ type: 'ping' });
  }

  reset(): void {
    this.worker?.postMessage({ type: 'app_reset' });
  }

  terminate(): void {
    this.rejectAllPending('Worker terminated');
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isInitialized = false;
  }

  isReady(): boolean {
    return this.isInitialized && this.worker !== null;
  }

  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}

export function createWorkerClient(options: WorkerClientOptions = {}): WorkerClient {
  return new WorkerClient(options);
}