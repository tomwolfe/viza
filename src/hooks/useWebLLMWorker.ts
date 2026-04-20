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
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isInferring, setIsInferring] = useState(false);
  const { setError: setVizaError, clearError: clearVizaError, error: vizaErrorState } = useVizaError();
  const [isDeviceCompatible, setIsDeviceCompatible] = useState(true);

  const error = vizaErrorState.message;
  const errorCode = vizaErrorState.code;

  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const workerClientRef = useRef<WorkerClient | null>(null);
  const isInitializedRef = useRef(false);
  const isModelReadyRef = useRef(false);

  const initWorker = useCallback(async () => {
    if (isInitializedRef.current) return;

    const gpuCheck = await checkWebGPU();
    if (!gpuCheck.supported || gpuCheck.memoryGB < 8) {
      setIsDeviceCompatible(false);
      setVizaError('WEBGPU_NOT_SUPPORTED', `WebGPU not supported or insufficient memory (requires ${gpuCheck.recommendedGB}GB+).`);
      return;
    }
    setIsDeviceCompatible(true);

    const client = createWorkerClient({
      onReady: () => {
        logger.info('[WebLLM] Worker ready');
      },
      onProgress: (progress) => {
        setModelProgress(progress);
        if (progress > 0 && progress < 100) {
          setIsModelLoading(true);
        }
      },
      onError: (message, code) => {
        logger.error('[WebLLM] Error:', message);
        setVizaError(code, message);
        setIsModelLoading(false);
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
        isModelReadyRef.current = false;
      },
      inferenceTimeoutMs: CONFIG.INFERENCE_TIMEOUT_MS,
      planningTimeoutMs: CONFIG.PLANNING_TIMEOUT_MS,
    });

    client.initialize(new URL('../worker/vision.worker.ts', import.meta.url).href);
    workerClientRef.current = client;
    isInitializedRef.current = true;
  }, [setVizaError]);

  const initModel = useCallback(async () => {
    if (!isInitializedRef.current) {
      await initWorker();
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

    setIsModelReady(false);
    setModelProgress(0);
    setIsModelLoading(true);

    try {
      await client.init(modelIdRef.current, DEFAULT_SYSTEM_PROMPT);
      isModelReadyRef.current = true;
      setIsModelLoading(false);
      setIsModelReady(true);
      setModelProgress(100);
      client.startHeartbeat(() => {
        logger.info('[WebLLM] Heartbeat reconnected');
      });
    } catch (err) {
      setVizaError('WORKER_INIT_FAILED', (err as Error).message);
      setIsModelLoading(false);
    }
  }, [initWorker, isDeviceCompatible, setVizaError]);

  const dispose = useCallback(() => {
    const client = workerClientRef.current;
    if (client) {
      client.stopHeartbeat();
      client.terminate();
      workerClientRef.current = null;
    }
    isInitializedRef.current = false;
    isModelReadyRef.current = false;
    setIsModelReady(false);
    setIsModelLoading(false);
    setIsInferring(false);
    clearVizaError();
  }, [clearVizaError]);

  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  return {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    error,
    errorCode,
    workerClient: workerClientRef.current,
    isModelReadyRef,
    initModel,
    dispose,
    setIsInferring,
  };
}
