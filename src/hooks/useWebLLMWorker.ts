'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  const [isModelInitializing, setIsModelInitializing] = useState(false);
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

  const getWorkerConfig = useMemo(() => ({
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
  }), [setVizaError]);

  const initWorker = useCallback(async (): Promise<boolean> => {
    console.debug('[WebLLM] initWorker called, isInitialized:', isInitializedRef.current);
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

    const client = createWorkerClient(getWorkerConfig);

    try {
      const worker = new Worker(
        new URL('../worker/vision.worker.ts', import.meta.url),
        { type: 'module' }
      );
      client.initialize(worker);
      workerClientRef.current = client;
      isInitializedRef.current = true;
      console.debug('[WebLLM] Worker initialized successfully');
      return true;
    } catch (err) {
      logger.error('[WebLLM] Worker creation failed:', err);
      setVizaError('WORKER_INIT_FAILED', 'Failed to create AI worker instance.');
      console.debug('[WebLLM] Worker initialization failed:', err);
      return false;
    }
  }, [setVizaError, getWorkerConfig]);

  const initModel = useCallback(async () => {
    console.debug('[WebLLM] initModel called, initializing:', isInitializingRef.current, 'ready:', isModelReady);
    
    if (errorCode === 'WEBGPU_NOT_SUPPORTED') {
      logger.warn('[WebLLM] Skipping init due to WebGPU incompatibility');
      return;
    }
    
    if (isInitializingRef.current || isModelReady) {
      return;
    }
    isInitializingRef.current = true;
    setIsModelInitializing(true);

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
      console.debug('[WebLLM] Model initialized, setting isModelReady to true');
      setIsModelReady(true);
      client.startHeartbeat(() => {
        const newClient = createWorkerClient(getWorkerConfig);
        const worker = new Worker(
          new URL('../worker/vision.worker.ts', import.meta.url),
          { type: 'module' }
        );
        newClient.initialize(worker);
        workerClientRef.current = newClient;
        newClient.startHeartbeat(() => {});
      });
    } catch (err) {
      const errorMsg = (err as Error).message;
      if (errorMsg.includes('shape') || errorMsg.includes('embed')) {
        setVizaError('MODEL_INIT_FAILED', 'Model cache corrupted - clearing and re-downloading. Please wait...');
      } else {
        setVizaError('MODEL_INIT_FAILED', errorMsg);
      }
    } finally {
      isInitializingRef.current = false;
      setIsModelInitializing(false);
    }
  }, [initWorker, isDeviceCompatible, setVizaError, isModelReady, getWorkerConfig, errorCode]);

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
    isModelInitializing,
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
