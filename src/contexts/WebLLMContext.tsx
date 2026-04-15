'use client';

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import type { VisionResponse, PlanningResponse, TaskStep } from '@/schemas/vision';
import { checkWebGPU, CONFIG, SYSTEM_PROMPT } from '@/config';
import { parseVisionResponse, parsePlanningResponse } from '@/schemas/vision';
import type { VizaErrorCode } from '@/types/worker';

const INFERENCE_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 30000;

export interface WebLLMContextValue {
  isModelLoading: boolean;
  modelProgress: number;
  isModelReady: boolean;
  isInferring: boolean;
  isDeviceCompatible: boolean;
  initModel: () => Promise<void>;
  runInference: (image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement, prompt: string) => Promise<VisionResponse | null>;
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

  const workerRef = useRef<Worker | null>(null);
  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const pendingRef = useRef<Map<string, { resolve: (value: VisionResponse | null) => void; timeoutId: ReturnType<typeof setTimeout> }>>(new Map());
  const planningPendingRef = useRef<Map<string, { resolve: (value: TaskStep[]) => void; timeoutId: ReturnType<typeof setTimeout> }>>(new Map());
  const isInitializedRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

    const worker = new Worker(new URL('../worker/vision.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { type, ...data } = event.data;

      switch (type) {
        case 'worker_ready':
          break;

        case 'init_progress':
          setModelProgress(data.progress || 0);
          setIsModelLoading(true);
          break;

        case 'init_complete':
          setIsModelLoading(false);
          setIsModelReady(true);
          setModelProgress(100);
          break;

        case 'inference_complete':
          setIsInferring(false);
          setLastCompleted(data.completed || false);
          if (data.messageId) {
            const pending = pendingRef.current.get(data.messageId);
            if (pending) {
              clearTimeout(pending.timeoutId);
              const validated = parseVisionResponse(data.response);
              if (validated) {
                pending.resolve(validated);
              } else {
                pending.resolve(null);
                setError('Invalid response schema from worker');
              }
              pendingRef.current.delete(data.messageId);
            }
          }
          break;

        case 'planning_complete':
          setIsInferring(false);
          if (data.messageId) {
            const pending = planningPendingRef.current.get(data.messageId);
            if (pending) {
              clearTimeout(pending.timeoutId);
              const validated = parsePlanningResponse(data.response);
              if (validated && validated.taskSteps) {
                pending.resolve(validated.taskSteps);
              } else {
                pending.resolve([]);
                setError('Invalid planning response from worker');
              }
              planningPendingRef.current.delete(data.messageId);
            }
          }
          break;

        case 'error':
          console.error('[WebLLM] Error:', data.message);
          setError(data.message);
          setErrorCode('WORKER_INIT_FAILED');
          setIsModelLoading(false);
          setIsInferring(false);
          if (data.messageId) {
            const pending = pendingRef.current.get(data.messageId);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pending.resolve(null);
              pendingRef.current.delete(data.messageId);
            }
          }
          break;

        case 'pong':
          break;

        case 'warning':
          break;

        default:
          break;
      }
    };

    worker.onerror = (errorEvent) => {
      console.error('[WebLLM] Worker error:', errorEvent);
      setError(`Worker error: ${errorEvent.message}`);
      setIsModelLoading(false);
      setIsInferring(false);
    };

    return () => {
      // NO worker.terminate() here - worker persists across navigation
    };
  }, []);

  const initModel = useCallback(async () => {
    if (!workerRef.current) {
      setError('Worker not initialized');
      return;
    }

    if (!isDeviceCompatible) {
      setError('Device not compatible with WebGPU');
      return;
    }

    setIsModelLoading(true);
    setModelProgress(0);
    setError(null);

    workerRef.current.postMessage({
      type: 'init',
      model: modelIdRef.current,
      systemPrompt: SYSTEM_PROMPT,
    });
  }, [isDeviceCompatible]);

  const runInference = useCallback(
    async (
      image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
      prompt: string
    ): Promise<VisionResponse | null> => {
      if (!workerRef.current || !isModelReady) {
        setError('Model not ready. Call initModel first.');
        return null;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsInferring(true);
      setError(null);

      const messageId = crypto.randomUUID();

      const result = new Promise<VisionResponse | null>((resolve) => {
        const timeoutId = setTimeout(() => {
          if (pendingRef.current.has(messageId)) {
            pendingRef.current.delete(messageId);
            setError('Inference timeout after 15s');
            setErrorCode('INFERENCE_TIMEOUT');
            setIsInferring(false);
            resolve(null);
          }
        }, INFERENCE_TIMEOUT_MS);

        pendingRef.current.set(messageId, { resolve, timeoutId });

        const imageSource: ImageBitmap | typeof image = image;

        workerRef.current!.postMessage(
          {
            type: 'chat',
            messageId,
            image: imageSource,
            prompt,
          },
          imageSource instanceof ImageBitmap ? [imageSource] : []
        );
      });

      return result;
    },
    [isModelReady]
  );

  const runPlanningInference = useCallback(
    async (image: ImageBitmap, goal: string): Promise<TaskStep[]> => {
      if (!workerRef.current || !isModelReady) {
        setError('Model not ready. Call initModel first.');
        return [];
      }

      setIsInferring(true);
      setError(null);

      const messageId = crypto.randomUUID();

      const result = new Promise<TaskStep[]>((resolve) => {
        const timeoutId = setTimeout(() => {
          if (planningPendingRef.current.has(messageId)) {
            planningPendingRef.current.delete(messageId);
            setError('Planning inference timeout after 30s');
            setErrorCode('INFERENCE_TIMEOUT');
            setIsInferring(false);
            resolve([]);
          }
        }, 30000);

        planningPendingRef.current.set(messageId, { resolve, timeoutId });

        workerRef.current!.postMessage(
          {
            type: 'planning',
            messageId,
            image,
            goal,
          },
          [image]
        );
      });

      return result;
    },
    [isModelReady]
  );

  const runCategoryInference = useCallback(
    async (image: ImageBitmap, goal: string): Promise<VisionResponse | null> => {
      if (!workerRef.current || !isModelReady) {
        setError('Model not ready. Call initModel first.');
        return null;
      }

      setIsInferring(true);
      setError(null);

      const messageId = crypto.randomUUID();

      const result = new Promise<VisionResponse | null>((resolve) => {
        const timeoutId = setTimeout(() => {
          if (pendingRef.current.has(messageId)) {
            pendingRef.current.delete(messageId);
            setError('Category inference timeout after 15s');
            setErrorCode('INFERENCE_TIMEOUT');
            setIsInferring(false);
            resolve(null);
          }
        }, INFERENCE_TIMEOUT_MS);

        pendingRef.current.set(messageId, { resolve, timeoutId });

        workerRef.current!.postMessage(
          {
            type: 'category',
            messageId,
            image,
            goal,
          },
          [image]
        );
      });

      return result;
    },
    [isModelReady]
  );

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const startHeartbeat = () => {
      heartbeatRef.current = setInterval(() => {
        worker.postMessage({ type: 'ping' });
      }, HEARTBEAT_INTERVAL_MS);
    };

    startHeartbeat();

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, []);

  const dispose = useCallback(() => {
    pendingRef.current.forEach(({ timeoutId }) => clearTimeout(timeoutId));
    pendingRef.current.clear();
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsModelReady(false);
    setIsModelLoading(false);
    setIsInferring(false);
    setError(null);
    setErrorCode(null);
    isInitializedRef.current = false;
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