'use client';

import type { VizaErrorCode, WorkerIncomingMessage } from '@/types/worker';
import { ensureBitmapClosed, isBitmapValid } from '@/utils/SafeTransfer';

export type WorkerMessageType =
  | 'init'
  | 'chat'
  | 'planning'
  | 'correction'
  | 'category'
  | 'verification'
  | 'reload'
  | 'soft_reload'
  | 'ping'
  | 'app_reset';

export interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  bitmapHandle: ImageBitmap | null;
  type: WorkerMessageType;
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
  initializationTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  onSoftReload?: () => void;
}

const DEFAULT_INFERENCE_TIMEOUT = 15000;
const DEFAULT_PLANNING_TIMEOUT = 30000;
const DEFAULT_INITIALIZATION_TIMEOUT = 300000;
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
  private softReloadEnabled = false;

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
      initializationTimeoutMs: options.initializationTimeoutMs ?? DEFAULT_INITIALIZATION_TIMEOUT,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT,
      onSoftReload: options.onSoftReload ?? (() => {}),
    };
  }

  initialize(worker: Worker): void {
    if (this.isInitialized) return;

    this.worker = worker;

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

    this.isInitialized = true;

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
    this.rejectAllPending('Worker unresponsive');
    this.terminate();
    this.isInitialized = false;
    
    setTimeout(() => {
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

      case 'correction_complete': {
        const messageId = data.messageId as string;
        const pending = this.pendingRequests.get(messageId);
        
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(messageId);
          pending.resolve({
            correctionSteps: data.response,
            analysis: (data as { analysis?: string }).analysis || '',
            rawText: (data as { rawText?: string }).rawText,
          });
        }
        break;
      }

      case 'verification_complete': {
        const messageId = data.messageId as string;
        const pending = this.pendingRequests.get(messageId);
        
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(messageId);
          pending.resolve({
            isCompleted: (data as { isCompleted?: boolean }).isCompleted ?? false,
            confidence: (data as { confidence?: number }).confidence ?? 0,
            rawText: (data as { rawText?: string }).rawText,
          });
        }
        break;
      }

      case 'error': {
        const messageId = (data as { messageId?: string }).messageId;
        if (messageId) {
          const pending = this.pendingRequests.get(messageId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            this.pendingRequests.delete(messageId);
          }
        }
        this.options.onError(
          (data as { message?: string }).message ?? 'Unknown worker error',
          (data as { errorCode?: VizaErrorCode }).errorCode ?? 'WORKER_INIT_FAILED',
          messageId
        );
        break;
      }

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

  private createTimeout(type: WorkerMessageType, messageId: string): ReturnType<typeof setTimeout> {
    let timeoutMs: number;

    switch (type) {
      case 'init':
        timeoutMs = this.options.initializationTimeoutMs;
        break;
      case 'planning':
      case 'correction':
        timeoutMs = this.options.planningTimeoutMs;
        break;
      default:
        timeoutMs = this.options.inferenceTimeoutMs;
        break;
    }

    return setTimeout(() => {
      this.pendingRequests.delete(messageId);

      const errorType = type === 'init' ? 'Initialization' : type === 'planning' || type === 'correction' ? 'Planning' : 'Inference';
      const errorCode = type === 'init' ? 'MODEL_INIT_FAILED' : 'INFERENCE_TIMEOUT';

      this.options.onError(
        `${errorType} timeout after ${timeoutMs / 1000}s`,
        errorCode,
        messageId
      );
    }, timeoutMs);
  }

  private createPendingRequest(
    type: WorkerMessageType,
    messageId: string,
    transfer?: Transferable[]
  ): PendingRequest<unknown> {
    const timeoutId = this.createTimeout(type, messageId);
    const bitmapHandle = transfer?.[0] instanceof ImageBitmap ? (transfer[0] as unknown as ImageBitmap) : null;

    const pending: PendingRequest<unknown> = {
      resolve: (() => {}) as (value: unknown) => void,
      reject: (() => {}) as (error: Error) => void,
      timeoutId,
      bitmapHandle,
      type,
    };

    this.pendingRequests.set(messageId, pending);

    return pending;
  }

  private rejectAllPending(reason: string): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      if (isBitmapValid(pending.bitmapHandle)) {
        ensureBitmapClosed(pending.bitmapHandle);
      }
      pending.reject(new Error(reason));
    });
    this.pendingRequests.clear();
  }

  private clearBitmapHandles(): void {
    this.pendingRequests.forEach((pending) => {
      if (isBitmapValid(pending.bitmapHandle)) {
        ensureBitmapClosed(pending.bitmapHandle);
      }
    });
    this.pendingRequests.forEach((pending) => {
      pending.bitmapHandle = null;
    });
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
    const bitmapHandle = transfer?.[0] instanceof ImageBitmap ? (transfer[0] as unknown as ImageBitmap) : null;

    return new Promise<T>((resolve, reject) => {
      const timeoutId = this.createTimeout(type, messageId);

      const pending: PendingRequest<T> = {
        resolve,
        reject,
        timeoutId,
        bitmapHandle,
        type: type,
      };

      this.pendingRequests.set(messageId, pending as PendingRequest<unknown>);

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(messageId);
      };

      const abortHandler = () => {
        if (isBitmapValid(bitmapHandle)) {
          ensureBitmapClosed(bitmapHandle);
        }
        cleanup();
        reject(new Error('Request aborted'));
      };

      signal?.addEventListener('abort', () => {
        abortHandler();
      }, { once: true });

      try {
        this.worker!.postMessage(
          { type, messageId, ...payload },
          transfer || []
        );

        const req = this.pendingRequests.get(messageId);
        if (req) {
          req.bitmapHandle = null;
        }
      } catch (err) {
        ensureBitmapClosed(bitmapHandle);
        cleanup();
        reject(err);
      }
    });
  }

  init(model: string, systemPrompt: string): Promise<void> {
    return this.sendMessage('init', { model, systemPrompt });
  }

  chat(image: ImageBitmap, prompt: string, messageId: string, signal?: AbortSignal): Promise<unknown> {
    return this.sendMessage('chat', { image, prompt, messageId }, [image], signal);
  }

  planning(image: ImageBitmap, goal: string, messageId: string, signal?: AbortSignal): Promise<unknown> {
    return this.sendMessage('planning', { image, goal, messageId }, [image], signal);
  }

  correction(image: ImageBitmap, analysis: string, originalStepIndex: number, messageId: string, signal?: AbortSignal): Promise<unknown> {
    return this.sendMessage('correction', { image, analysis, originalStepIndex, messageId }, [image], signal);
  }

  category(image: ImageBitmap, goal: string, messageId: string, signal?: AbortSignal): Promise<unknown> {
    return this.sendMessage('category', { image, goal, messageId }, [image], signal);
  }

  verification(image: ImageBitmap, validationPrompt: string, targetObject: string, messageId: string, signal?: AbortSignal): Promise<unknown> {
    const _userInput = `${validationPrompt}|||${targetObject}`;
    return this.sendMessage('verification', { image, validationPrompt, targetObject, messageId }, [image], signal);
  }

  ping(): void {
    this.worker?.postMessage({ type: 'ping' });
  }

  reset(): void {
    this.worker?.postMessage({ type: 'app_reset' });
  }

  softReload(model?: string, systemPrompt?: string): void {
    if (!this.worker) return;
    this.worker?.postMessage({
      type: 'soft_reload',
      model: model || 'model',
      systemPrompt: systemPrompt || '',
    });
    this.softReloadEnabled = true;
    this.options.onSoftReload();
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