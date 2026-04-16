'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SYSTEM_PROMPT, logger, CONFIG, checkWebGPU } from '@/config';
import { WorkerClient, createWorkerClient } from '@/utils/workerClient';
import type { VizaErrorCode } from '@/types/worker';

interface UseWebLLMWorkerOptions {
  modelId?: string;
}

export function useWebLLMWorker({ modelId }: UseWebLLMWorkerOptions = {}) {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isInferring, setIsInferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VizaErrorCode | null>(null);
  const [isDeviceCompatible, setIsDeviceCompatible] = useState(true);

  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const workerClientRef = useRef<WorkerClient | null>(null);
  const isInitializedRef = useRef(false);
  const isModelReadyRef = useRef(false);

  const initWorker = useCallback(async () => {
    if (isInitializedRef.current) return;

    const gpuCheck = await checkWebGPU();
    if (!gpuCheck.supported || gpuCheck.memoryGB < 8) {
      setIsDeviceCompatible(false);
      setError(`WebGPU not supported or insufficient memory (requires ${gpuCheck.recommendedGB}GB+).`);
      setErrorCode('WEBGPU_NOT_SUPPORTED');
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
        setError(message);
        setErrorCode(code);
        setIsModelLoading(false);
        setIsInferring(false);
      },
      onWarning: (message) => {
        logger.warn('[WebLLM] Warning:', message);
      },
      onPong: () => {},
      onUnresponsive: () => {
        logger.warn('[WebLLM] Worker unresponsive');
        setError('AI Engine Lost - Restarting...');
        setIsModelReady(false);
        isModelReadyRef.current = false;
      },
      inferenceTimeoutMs: CONFIG.INFERENCE_TIMEOUT_MS,
      planningTimeoutMs: CONFIG.PLANNING_TIMEOUT_MS,
    });

    client.initialize(new URL('../worker/vision.worker.ts', import.meta.url).href);
    workerClientRef.current = client;
    isInitializedRef.current = true;
  }, []);

  const initModel = useCallback(async () => {
    if (!isInitializedRef.current) {
      await initWorker();
    }

    if (!isDeviceCompatible) {
      setError('Device not compatible with WebGPU');
      return;
    }

    const client = workerClientRef.current;
    if (!client) {
      setError('Worker not initialized');
      return;
    }

    setIsModelReady(false);
    setModelProgress(0);
    setIsModelLoading(true);
    setError(null);

    try {
      await client.init(modelIdRef.current, SYSTEM_PROMPT);
      isModelReadyRef.current = true;
      setIsModelLoading(false);
      setIsModelReady(true);
      setModelProgress(100);
      client.startHeartbeat(() => {
        logger.info('[WebLLM] Heartbeat reconnected');
      });
    } catch (err) {
      setError((err as Error).message);
      setErrorCode('WORKER_INIT_FAILED');
      setIsModelLoading(false);
    }
  }, [initWorker, isDeviceCompatible]);

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
    setError(null);
    setErrorCode(null);
  }, []);

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
    setError,
    setErrorCode,
  };
}
