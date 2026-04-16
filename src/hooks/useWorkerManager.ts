'use client';

import { useRef, useCallback, useEffect } from 'react';
import { WorkerClient, createWorkerClient, type WorkerMessageType } from '@/utils/workerClient';
import { checkWebGPU, CONFIG, logger } from '@/config';
import type { VizaErrorCode } from '@/types/worker';

interface UseWorkerManagerOptions {
  onReady?: () => void;
  onProgress?: (progress: number) => void;
  onComplete?: (messageId: string, response: unknown, completed?: boolean) => void;
  onPlanningComplete?: (messageId: string, response: unknown) => void;
  onError?: (message: string, code: VizaErrorCode, messageId?: string) => void;
  onWarning?: (message: string) => void;
  onPong?: () => void;
  onUnresponsive?: () => void;
}

interface UseWorkerManagerReturn {
  isInitialized: boolean;
  isModelReady: boolean;
  isDeviceCompatible: boolean;
  initWorker: () => Promise<void>;
  initModel: (modelId: string, systemPrompt: string) => Promise<void>;
  dispose: () => void;
  sendMessage: <T>(
    type: WorkerMessageType,
    payload: Record<string, unknown>,
    transfer?: Transferable[]
  ) => Promise<T>;
  chat: (image: ImageBitmap, prompt: string, messageId: string) => Promise<unknown>;
  planning: (image: ImageBitmap, goal: string, messageId: string) => Promise<unknown>;
  category: (image: ImageBitmap, goal: string, messageId: string) => Promise<unknown>;
  ping: () => void;
  reset: () => void;
  getPendingCount: () => number;
}

export function useWorkerManager(options: UseWorkerManagerOptions = {}): UseWorkerManagerReturn {
  const workerClientRef = useRef<WorkerClient | null>(null);
  const isInitializedRef = useRef(false);
  const isModelReadyRef = useRef(false);
  const isDeviceCompatibleRef = useRef(true);
  const pendingResolvesRef = useRef<Map<string, (value: unknown) => void>>(new Map());
  const errorRef = useRef<string | null>(null);
  const errorCodeRef = useRef<VizaErrorCode | null>(null);

  const handleComplete = useCallback(
    (messageId: string, response: unknown, completed?: boolean) => {
      options.onComplete?.(messageId, response, completed);
    },
    [options]
  );

  const handlePlanningComplete = useCallback(
    (messageId: string, response: unknown) => {
      options.onPlanningComplete?.(messageId, response);
    },
    [options]
  );

  const handleError = useCallback(
    (message: string, code: VizaErrorCode, messageId?: string) => {
      errorRef.current = message;
      errorCodeRef.current = code;
      options.onError?.(message, code, messageId);
    },
    [options]
  );

  const handleWarning = useCallback(
    (message: string) => {
      options.onWarning?.(message);
    },
    [options]
  );

  const handlePong = useCallback(() => {
    options.onPong?.();
  }, [options]);

  const handleUnresponsive = useCallback(() => {
    isModelReadyRef.current = false;
    options.onUnresponsive?.();
  }, [options]);

  const initWorker = useCallback(async () => {
    if (isInitializedRef.current) return;

    const gpuCheck = await checkWebGPU();
    if (!gpuCheck.supported || gpuCheck.memoryGB < 8) {
      isDeviceCompatibleRef.current = false;
      handleError(
        `WebGPU not supported or insufficient memory (requires ${gpuCheck.recommendedGB}GB+).`,
        'WEBGPU_NOT_SUPPORTED'
      );
      return;
    }
    isDeviceCompatibleRef.current = true;

    const client = createWorkerClient({
      onReady: options.onReady,
      onProgress: options.onProgress,
      onComplete: handleComplete,
      onPlanningComplete: handlePlanningComplete,
      onError: handleError,
      onWarning: handleWarning,
      onPong: handlePong,
      onUnresponsive: handleUnresponsive,
      inferenceTimeoutMs: CONFIG.INFERENCE_TIMEOUT_MS,
      planningTimeoutMs: CONFIG.PLANNING_TIMEOUT_MS,
    });

    client.initialize(new URL('../worker/vision.worker.ts', import.meta.url).href);
    workerClientRef.current = client;
    isInitializedRef.current = true;
  }, [options, handleComplete, handlePlanningComplete, handleError, handleWarning, handlePong, handleUnresponsive]);

  const initModel = useCallback(
    async (modelId: string, systemPrompt: string) => {
      const client = workerClientRef.current;
      if (!client) {
        handleError('Worker not initialized', 'WORKER_INIT_FAILED');
        return;
      }

      client.setModelReady(false);
      isModelReadyRef.current = false;

      try {
        await client.init(modelId, systemPrompt);
        isModelReadyRef.current = true;
        client.startHeartbeat(() => {
          logger.info('[WorkerManager] Heartbeat reconnected');
        });
      } catch (err) {
        handleError((err as Error).message, 'WORKER_INIT_FAILED');
      }
    },
    [handleError]
  );

  const sendMessage = useCallback(
    async <T,>(
      type: WorkerMessageType,
      payload: Record<string, unknown>,
      transfer?: Transferable[]
    ): Promise<T> => {
      const client = workerClientRef.current;
      if (!client) {
        return Promise.reject(new Error('Worker not initialized'));
      }
      return client.sendMessage<T>(type, payload, transfer);
    },
    []
  );

  const chat = useCallback(
    (image: ImageBitmap, prompt: string, messageId: string) => {
      const client = workerClientRef.current;
      if (!client) {
        return Promise.reject(new Error('Worker not initialized'));
      }
      return client.chat(image, prompt, messageId);
    },
    []
  );

  const planning = useCallback(
    (image: ImageBitmap, goal: string, messageId: string) => {
      const client = workerClientRef.current;
      if (!client) {
        return Promise.reject(new Error('Worker not initialized'));
      }
      return client.planning(image, goal, messageId);
    },
    []
  );

  const category = useCallback(
    (image: ImageBitmap, goal: string, messageId: string) => {
      const client = workerClientRef.current;
      if (!client) {
        return Promise.reject(new Error('Worker not initialized'));
      }
      return client.category(image, goal, messageId);
    },
    []
  );

  const ping = useCallback(() => {
    workerClientRef.current?.ping();
  }, []);

  const reset = useCallback(() => {
    workerClientRef.current?.reset();
  }, []);

  const getPendingCount = useCallback(() => {
    return workerClientRef.current?.getPendingCount() ?? 0;
  }, []);

  const dispose = useCallback(() => {
    if (workerClientRef.current) {
      workerClientRef.current.stopHeartbeat();
      workerClientRef.current.terminate();
      workerClientRef.current = null;
    }
    isInitializedRef.current = false;
    isModelReadyRef.current = false;
    pendingResolvesRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  return {
    isInitialized: isInitializedRef.current,
    isModelReady: isModelReadyRef.current,
    isDeviceCompatible: isDeviceCompatibleRef.current,
    initWorker,
    initModel,
    dispose,
    sendMessage,
    chat,
    planning,
    category,
    ping,
    reset,
    getPendingCount,
  };
}