/* eslint-disable react-hooks/exhaustive-deps */
// intentionally excludes vizaErrorState from initWorker deps to prevent circular dependency loop
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { DEFAULT_SYSTEM_PROMPT } from '@/services/promptManager';
import { logger, CONFIG, checkWebGPU } from '@/config';
import { WorkerClient, createWorkerClient } from '@/utils/workerClient';
import { useVizaError } from '@/contexts/VizaErrorContext';


interface UseWebLLMWorkerOptions {
  modelId?: string;
}

export function useWebLLMWorker({ modelId }: UseWebLLMWorkerOptions = {}) {
  const [isInferring, setIsInferring] = useState(false);
  const { setError: setVizaError, clearError: clearVizaError, error: vizaErrorState } = useVizaError();
  const [isDeviceCompatible, setIsDeviceCompatible] = useState(true);

  const error = vizaErrorState.message;
  const errorCode = vizaErrorState.code;

  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const workerClientRef = useRef<WorkerClient | null>(null);
  const isInitializedRef = useRef(false);
  const isInitializingRef = useRef(false);
  const [isModelReady, setIsModelReady] = useState(false);

   const initWorker = useCallback(async (): Promise<boolean> => {
    if (isInitializedRef.current) return true;

    const gpuCheck = await checkWebGPU();
    if (!gpuCheck.supported) {
      setIsDeviceCompatible(false);
      if (vizaErrorState.code !== 'WEBGPU_NOT_SUPPORTED') {
        setVizaError('WEBGPU_NOT_SUPPORTED', `WebGPU not supported: ${gpuCheck.issues.join('; ')}`);
      }
      return false;
    }
    setIsDeviceCompatible(true);

    const client = createWorkerClient({
      onReady: () => {
        logger.info('[WebLLM] Worker ready');
      },
      onProgress: () => {},
      onError: (message, code) => {
        logger.error('[WebLLM] Error:', message);
        setVizaError(code, message);
        setIsInferring(false);
      },
      onWarning: (message) => {
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
    });

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
        const newClient = createWorkerClient({
          onReady: () => {
            logger.info('[WebLLM] Worker ready');
          },
          onProgress: () => {},
          onError: (message, code) => {
            logger.error('[WebLLM] Error:', message);
            setVizaError(code, message);
            setIsInferring(false);
          },
          onWarning: (message) => {
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
        });
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
  }, [initWorker, isDeviceCompatible, isInitializedRef, setVizaError, isModelReady]);

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
    setIsModelReady,
    initModel,
    dispose,
    setIsInferring,
  };
}
