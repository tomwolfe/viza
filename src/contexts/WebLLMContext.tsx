'use client';

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import type { VisionResponse, TaskStep } from '@/schemas/vision';
import { checkWebGPU, CONFIG, SYSTEM_PROMPT, logger } from '@/config';
import { parseVisionResponse, parsePlanningResponse } from '@/schemas/vision';
import type { VizaErrorCode } from '@/types/worker';
import { WorkerClient } from '@/utils/workerClient';

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

  const workerClientRef = useRef<WorkerClient | null>(null);
  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isInitializedRef = useRef(false);
  const pendingResolvesRef = useRef<Map<string, (value: InferenceResult) => void>>(new Map());

  useEffect(() => {
    checkWebGPU().then((result) => {
      if (!result.supported || result.memoryGB < 8) {
        setIsDeviceCompatible(false);
        setError(`WebGPU not supported or insufficient memory (requires ${result.recommendedGB}GB+).`);
        setErrorCode('WEBGPU_NOT_SUPPORTED');
      }
    });
  }, []);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const client = new WorkerClient({
      onReady: () => {
        logger.info('[WebLLM] Worker ready');
      },
      onProgress: (progress) => {
        setModelProgress(progress);
        if (progress > 0 && progress < 100) {
          setIsModelLoading(true);
        }
      },
      onComplete: (messageId, response, completed) => {
        setIsInferring(false);
        setLastCompleted(completed ?? false);
        
        const resolve = pendingResolvesRef.current.get(messageId);
        if (resolve) {
          pendingResolvesRef.current.delete(messageId);
          const validated = parseVisionResponse(response);
          resolve(validated);
        }
      },
      onPlanningComplete: (messageId, response) => {
        setIsInferring(false);
        
        const resolve = pendingResolvesRef.current.get(messageId);
        if (resolve) {
          pendingResolvesRef.current.delete(messageId);
          const validated = parsePlanningResponse(response);
          resolve(validated?.taskSteps ?? []);
        }
      },
      onError: (message, code, messageId) => {
        logger.error('[WebLLM] Error:', message);
        setError(message);
        setErrorCode(code);
        setIsModelLoading(false);
        setIsInferring(false);

        if (messageId) {
          const resolve = pendingResolvesRef.current.get(messageId);
          if (resolve) {
            pendingResolvesRef.current.delete(messageId);
            resolve(null);
          }
        }
      },
      onPong: () => {},
      onUnresponsive: () => {
        logger.warn('[WebLLM] Worker unresponsive');
        setError('AI Engine Lost - Restarting...');
        setIsModelReady(false);
      },
      inferenceTimeoutMs: CONFIG.INFERENCE_TIMEOUT_MS,
      planningTimeoutMs: CONFIG.PLANNING_TIMEOUT_MS,
    });

    client.initialize(new URL('../worker/vision.worker.ts', import.meta.url).href);
    workerClientRef.current = client;

    return () => {
      client.stopHeartbeat();
      client.terminate();
    };
  }, []);

  const initModelInternal = useCallback(async () => {
    if (!workerClientRef.current) return;
    
    const client = workerClientRef.current;
    client.setModelReady(false);
    setIsModelReady(false);
    setModelProgress(0);
    setIsModelLoading(true);
    setError(null);

    try {
      await client.init(modelIdRef.current, SYSTEM_PROMPT);
      setIsModelLoading(false);
      setIsModelReady(true);
      setModelProgress(100);
      client.startHeartbeat(() => {
        setError(null);
        initModelInternal();
      });
    } catch (err) {
      setError((err as Error).message);
      setErrorCode('WORKER_INIT_FAILED');
      setIsModelLoading(false);
    }
  }, []);

  const initModel = useCallback(async () => {
    if (!workerClientRef.current) {
      setError('Worker not initialized');
      return;
    }

    if (!isDeviceCompatible) {
      setError('Device not compatible with WebGPU');
      return;
    }

    await initModelInternal();
  }, [isDeviceCompatible, initModelInternal]);

  const dispatchInference = useCallback(
    async (
      image: ImageBitmap,
      prompt: string,
      inferenceType: InferenceType
    ): Promise<InferenceResult> => {
      const client = workerClientRef.current;
      if (!client || !client.isModelReady()) {
        setError('Model not ready. Call initModel first.');
        return inferenceType === 'planning' ? [] : null;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsInferring(true);
      setError(null);

      const messageId = crypto.randomUUID();

      return new Promise<InferenceResult>((resolve) => {
        pendingResolvesRef.current.set(messageId, resolve);

        if (inferenceType === 'planning') {
          client.planning(image, prompt, messageId).catch((err) => {
            setError(err.message);
            setErrorCode('INFERENCE_ERROR');
            setIsInferring(false);
            resolve([]);
          });
        } else if (inferenceType === 'category') {
          client.category(image, prompt, messageId).catch((err) => {
            setError(err.message);
            setErrorCode('INFERENCE_ERROR');
            setIsInferring(false);
            resolve(null);
          });
        } else {
          client.chat(image, prompt, messageId).catch((err) => {
            setError(err.message);
            setErrorCode('INFERENCE_ERROR');
            setIsInferring(false);
            resolve(null);
          });
        }
      });
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
    pendingResolvesRef.current.clear();
    if (workerClientRef.current) {
      workerClientRef.current.stopHeartbeat();
      workerClientRef.current.terminate();
      workerClientRef.current = null;
    }
    isInitializedRef.current = false;
    setIsModelReady(false);
    setIsModelLoading(false);
    setIsInferring(false);
    setError(null);
    setErrorCode(null);
  }, []);

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