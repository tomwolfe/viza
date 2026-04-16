'use client';

import type { VizaErrorCode } from '@/types/worker';

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
  sequenceNumber: number;
}

export interface WorkerClientOptions {
  onReady?: () => void;
  onProgress?: (progress: number) => void;
  onComplete?: (messageId: string, response: unknown, completed?: boolean) => void;
  onPlanningComplete?: (messageId: string, response: unknown) => void;
  onError?: (message: string, code: VizaErrorCode, messageId?: string) => void;
  onWarning?: (message: string) => void;
  onPong?: () => void;
  inferenceTimeoutMs?: number;
  planningTimeoutMs?: number;
}

const DEFAULT_INFERENCE_TIMEOUT = 15000;
const DEFAULT_PLANNING_TIMEOUT = 30000;

export class WorkerClient {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, PendingRequest<unknown>> = new Map();
  private sequenceNumber = 0;
  private isInitialized = false;
  private options: Required<WorkerClientOptions>;
  private messageHandlers: Map<string, (data: Record<string, unknown>) => void> = new Map();

  constructor(options: WorkerClientOptions = {}) {
    this.options = {
      onReady: options.onReady ?? (() => {}),
      onProgress: options.onProgress ?? (() => {}),
      onComplete: options.onComplete ?? (() => {}),
      onPlanningComplete: options.onPlanningComplete ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onWarning: options.onWarning ?? (() => {}),
      onPong: options.onPong ?? (() => {}),
      inferenceTimeoutMs: options.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT,
      planningTimeoutMs: options.planningTimeoutMs ?? DEFAULT_PLANNING_TIMEOUT,
    };
  }

  initialize(workerUrl: string): void {
    if (this.isInitialized) return;

    this.worker = new Worker(workerUrl, { type: 'module' });

    this.worker.onmessage = (event) => {
      this.handleMessage(event.data as Record<string, unknown>);
    };

    this.worker.onerror = (errorEvent) => {
      this.options.onError(
        `Worker error: ${errorEvent.message}`,
        'WORKER_CRASHED'
      );
      this.rejectAllPending('Worker crashed');
    };

    this.isInitialized = this.isInitialized || true;
  }

  private handleMessage(data: Record<string, unknown>): void {
    const { type, errorCode, ...rest } = data;

    switch (type) {
      case 'worker_ready':
        this.options.onReady();
        break;

      case 'init_progress':
        this.options.onProgress((data.progress as number) ?? 0);
        break;

      case 'init_complete':
        this.options.onProgress(100);
        break;

      case 'inference_complete': {
        const messageId = data.messageId as string;
        const pending = this.pendingRequests.get(messageId);
        
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(messageId);
          this.options.onComplete(messageId, data.response, data.completed as boolean | undefined);
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
        }
        break;
      }

      case 'error':
        this.options.onError(
          (data.message as string) ?? 'Unknown worker error',
          (errorCode as VizaErrorCode) ?? 'WORKER_INIT_FAILED',
          data.messageId as string | undefined
        );
        break;

      case 'warning':
        this.options.onWarning((data.message as string) ?? 'Unknown warning');
        break;

      case 'pong':
        this.options.onPong();
        break;

      default:
        break;
    }
  }

  private createRequestId(): string {
    return crypto.randomUUID();
  }

  private createTimeout(type: 'chat' | 'planning' | 'category'): ReturnType<typeof setTimeout> {
    const timeoutMs = type === 'planning' 
      ? this.options.planningTimeoutMs 
      : this.options.inferenceTimeoutMs;
    
    return setTimeout(() => {
      this.options.onError(
        `${type === 'planning' ? 'Planning' : type === 'category' ? 'Category' : 'Inference'} timeout after ${timeoutMs / 1000}s`,
        'INFERENCE_TIMEOUT'
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
    transfer?: Transferable[]
  ): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not initialized'));
    }

    const messageId = this.createRequestId();
    const seqNum = ++this.sequenceNumber;
    const inferenceType = type === 'planning' ? 'planning' : type === 'category' ? 'category' : 'chat';

    return new Promise<T>((resolve, reject) => {
      const timeoutId = this.createTimeout(inferenceType);

      this.pendingRequests.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
        type: inferenceType,
        sequenceNumber: seqNum,
      });

      this.worker!.postMessage(
        { type, messageId, ...payload },
        transfer
      );
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