'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import type { VisionResponse, TaskStep } from '@/schemas/vision';
import { SYSTEM_PROMPT, logger, CONFIG } from '@/config';
import { parseVisionResponse, parsePlanningResponse } from '@/schemas/vision';
import type { VizaErrorCode } from '@/types/worker';
import { WorkerClient, createWorkerClient, type WorkerMessageType } from '@/utils/workerClient';
import { checkWebGPU } from '@/config';

type InferenceResult = VisionResponse | null | TaskStep[];

type InferenceType = 'chat' | 'planning' | 'category';

export interface WebLLMContextValue {
  isModelLoading: boolean;
  modelProgress: number;
  isModelReady: boolean;
  isInferring: boolean;
  isDeviceCompatible: boolean;
  initModel: () => Promise<void>;
  runInference: (image: ImageBitmap, prompt: string) => Promise<VisionResponse | null>;
  runPlanningInference: (image: ImageBitmap, goal: string) => Promise<TaskStep[]>;
  runCategoryInference: (image: ImageBitmap, goal: string) => Promise<VisionResponse | null>;
  dispose: () => void;
  error: string | null;
  errorCode: VizaErrorCode | null;
  lastCompleted: boolean;
}

const WebLLMContext = createContext<WebLLMContextValue | null>(null);

interface WebLLMProviderProps {
  children: ReactNode;
  modelId?: string;
}

export function WebLLMProvider({ children, modelId }: WebLLMProviderProps) {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isInferring, setIsInferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VizaErrorCode | null>(null);
  const [isDeviceCompatible, setIsDeviceCompatible] = useState(true);
  const [lastCompleted, setLastCompleted] = useState(false);

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

  const dispatchInference = useCallback(
    async (
      image: ImageBitmap,
      prompt: string,
      inferenceType: InferenceType,
      signal?: AbortSignal
    ): Promise<InferenceResult> => {
      if (!isModelReadyRef.current) {
        setError('Model not ready. Call initModel first.');
        return inferenceType === 'planning' ? [] : null;
      }

      const client = workerClientRef.current;
      if (!client) {
        setError('Worker not initialized');
        return inferenceType === 'planning' ? [] : null;
      }

      setIsInferring(true);
      setError(null);

      const messageId = crypto.randomUUID();

      try {
        const infPromise = inferenceType === 'planning'
          ? client.planning(image, prompt, messageId)
          : inferenceType === 'category'
          ? client.category(image, prompt, messageId)
          : client.chat(image, prompt, messageId);

        const response = await infPromise;

        if (inferenceType === 'planning') {
          const validated = parsePlanningResponse(response);
          return validated?.taskSteps ?? [];
        } else {
          const validated = parseVisionResponse(response);
          if (validated) {
            setLastCompleted(validated.completed);
          }
          return validated;
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage !== 'Request aborted') {
          logger.error(`[WebLLM] ${inferenceType} error:`, err);
          setError(errorMessage);
          setErrorCode('INFERENCE_ERROR');
        }
        return inferenceType === 'planning' ? [] : null;
      } finally {
        setIsInferring(false);
      }
    },
    []
  );

  const runInference = useCallback(
    async (image: ImageBitmap, prompt: string): Promise<VisionResponse | null> => {
      const result = await dispatchInference(image, prompt, 'chat');
      return result as VisionResponse | null;
    },
    [dispatchInference]
  );

  const runPlanningInference = useCallback(
    async (image: ImageBitmap, goal: string): Promise<TaskStep[]> => {
      const result = await dispatchInference(image, goal, 'planning');
      return result as TaskStep[];
    },
    [dispatchInference]
  );

  const runCategoryInference = useCallback(
    async (image: ImageBitmap, goal: string): Promise<VisionResponse | null> => {
      const result = await dispatchInference(image, goal, 'category');
      return result as VisionResponse | null;
    },
    [dispatchInference]
  );

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

  return (
    <WebLLMContext.Provider
      value={{
        isModelLoading,
        modelProgress,
        isModelReady,
        isInferring,
        isDeviceCompatible,
        initModel,
        runInference,
        runPlanningInference,
        runCategoryInference,
        dispose,
        error,
        errorCode,
        lastCompleted,
      }}
    >
      {children}
    </WebLLMContext.Provider>
  );
}

export function useWebLLM(): WebLLMContextValue {
  const context = useContext(WebLLMContext);
  if (!context) {
    throw new Error('useWebLLM must be used within a WebLLMProvider');
  }
  return context;
}