'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { DEFAULT_SYSTEM_PROMPT } from '@/services/promptManager';
import { logger, CONFIG, checkWebGPU } from '@/config';
import { WorkerClient, createWorkerClient } from '@/utils/workerClient';
import { useVizaError } from '@/contexts/VizaErrorContext';
import type { VizaErrorCode } from '@/types/worker';


interface UseWebLLMWorkerOptions {
  modelId?: string;
}

export function useWebLLMWorker({ modelId }: UseWebLLMWorkerOptions = {}) {
  const [isInferring, setIsInferring] = useState(false);
  const { setError: setVizaError, clearError: clearVizaError, error: vizaErrorState } = useVizaError();
  const [isDeviceCompatible, setIsDeviceCompatible] = useState(true);
  const [modelProgress, setModelProgress] = useState(0);

  const error = vizaErrorState.message;
  const errorCode = vizaErrorState.code;

  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const workerClientRef = useRef<WorkerClient | null>(null);
  const isInitializedRef = useRef(false);
  const isInitializingRef = useRef(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const vizaErrorCodeRef = useRef(vizaErrorState.code);

  useEffect(() => {
    vizaErrorCodeRef.current = vizaErrorState.code;
  }, [vizaErrorState.code]);

   const getWorkerConfig = () => ({
    onReady: () => {
      logger.info('[WebLLM] Worker ready');
    },
    onProgress: (progress: number) => {
      setModelProgress(progress);
    },
    onError: (message: string, code: VizaErrorCode) => {
      logger.error('[WebLLM] Error:', message);
      setVizaError(code, message);
      setIsInferring(false);
    },
    onWarning: (message: string) => {
      logger.warn('[WebLLM] Warning:', message);
    },
    onPong: () => {},
    onUnresponsive: () => {
      logger.warn('[WebLLM] Worker unresponsive');
      setVizaError('WORKER_CRASHED', 'AI Engine Lost - Restarting...');
      setIsModelReady(false);
    },
    inferenceTimeoutMs: CONFIG.INFERENCE_TIMEOUT_MS,
    planningTimeoutMs: CONFIG.PLANNING_TIMEOUT_MS,
    initializationTimeoutMs: CONFIG.INITIALIZATION_TIMEOUT_MS,
  });

  const initWorker = useCallback(async (): Promise<boolean> => {
    if (isInitializedRef.current) return true;

    const gpuCheck = await checkWebGPU();
    if (!gpuCheck.supported) {
      setIsDeviceCompatible(false);
      if (vizaErrorCodeRef.current !== 'WEBGPU_NOT_SUPPORTED') {
        setVizaError('WEBGPU_NOT_SUPPORTED', `WebGPU not supported: ${gpuCheck.issues.join('; ')}`);
      }
      return false;
    }
    setIsDeviceCompatible(true);

    const workerConfig = getWorkerConfig();
    const client = createWorkerClient(workerConfig);

    try {
      const worker = new Worker(
        new URL('../worker/vision.worker.ts', import.meta.url),
        { type: 'module' }
      );
      client.initialize(worker);
      workerClientRef.current = client;
      isInitializedRef.current = true;
      return true;
    } catch (err) {
      logger.error('[WebLLM] Worker creation failed:', err);
      setVizaError('WORKER_INIT_FAILED', 'Failed to create AI worker instance.');
      return false;
    }
  }, [setVizaError]);

  const initModel = useCallback(async () => {
    if (isInitializingRef.current || isModelReady) {
      return;
    }
    isInitializingRef.current = true;

    try {
      if (!isInitializedRef.current) {
        const success = await initWorker();
        if (!success) {
          return;
        }
      }

      if (!isDeviceCompatible) {
        setVizaError('WEBGPU_NOT_SUPPORTED', 'Device not compatible with WebGPU');
        return;
      }

      const client = workerClientRef.current;
      if (!client) {
        setVizaError('WORKER_INIT_FAILED', 'Worker not initialized');
        return;
      }

      await client.init(modelIdRef.current, DEFAULT_SYSTEM_PROMPT);
      setIsModelReady(true);
      client.startHeartbeat(() => {
        const workerConfig = getWorkerConfig();
        const newClient = createWorkerClient(workerConfig);
        const worker = new Worker(
          new URL('../worker/vision.worker.ts', import.meta.url),
          { type: 'module' }
        );
        newClient.initialize(worker);
        workerClientRef.current = newClient;
        newClient.startHeartbeat(() => {});
      });
    } catch (err) {
      setVizaError('WORKER_INIT_FAILED', (err as Error).message);
    } finally {
      isInitializingRef.current = false;
    }
  }, [initWorker, isDeviceCompatible, setVizaError, isModelReady]);

  const dispose = useCallback(() => {
    const client = workerClientRef.current;
    if (client) {
      client.stopHeartbeat();
      client.terminate();
      workerClientRef.current = null;
    }
    isInitializedRef.current = false;
    setIsModelReady(false);
    setIsInferring(false);
    clearVizaError();
  }, [clearVizaError]);

  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  return {
    isInferring,
    isDeviceCompatible,
    error,
    errorCode,
    workerClient: workerClientRef.current,
    isModelReady: isModelReady,
    modelProgress,
    setIsModelReady,
    initModel,
    dispose,
    setIsInferring,
  };
}
