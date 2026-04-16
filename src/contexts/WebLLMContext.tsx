'use client';

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import type { VisionResponse, TaskStep } from '@/schemas/vision';
import { checkWebGPU, CONFIG, SYSTEM_PROMPT, logger } from '@/config';
import { parseVisionResponse, parsePlanningResponse } from '@/schemas/vision';
import type { VizaErrorCode } from '@/types/worker';

const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 60000;

type InferenceResult = VisionResponse | null | TaskStep[];

interface PendingRequest {
  type: InferenceType;
  resolve: (value: InferenceResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  image?: ImageBitmap;
}

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

  const workerRef = useRef<Worker | null>(null);
  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const isInitializedRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastPongRef = useRef<number>(0);
  const reconnectAttemptRef = useRef<number>(0);

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

    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../worker/vision.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    const worker = workerRef.current;
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { type, errorCode, ...data } = event.data as { type: string; messageId?: string; response?: unknown; completed?: boolean; message?: string; progress?: number; errorCode?: string };

      switch (type) {
        case 'worker_ready':
          break;

        case 'init_progress':
          setModelProgress(data.progress ?? 0);
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
              pendingRef.current.delete(data.messageId);
              if (pending.type === 'planning') {
                const validated = parsePlanningResponse(data.response);
                if (validated && validated.taskSteps) {
                  pending.resolve(validated.taskSteps);
                } else {
                  pending.resolve([]);
                  setError('Invalid planning response from worker');
                }
              } else {
                const validated = parseVisionResponse(data.response);
                if (validated) {
                  pending.resolve(validated);
                } else {
                  pending.resolve(null);
                  setError('Invalid response schema from worker');
                }
              }
            }
          }
          break;

        case 'planning_complete':
          setIsInferring(false);
          if (data.messageId) {
            const pending = pendingRef.current.get(data.messageId);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingRef.current.delete(data.messageId);
              const validated = parsePlanningResponse(data.response);
              if (validated && validated.taskSteps) {
                pending.resolve(validated.taskSteps);
              } else {
                pending.resolve([]);
                setError('Invalid planning response from worker');
              }
            }
          }
          break;

        case 'error':
          logger.error('[WebLLM] Error:', data.message);
          setError(data.message ?? 'Unknown worker error');
          const code = errorCode as VizaErrorCode | undefined;
          setErrorCode(code ?? 'WORKER_INIT_FAILED');
          setIsModelLoading(false);
          setIsInferring(false);
          if (data.messageId) {
            const pending = pendingRef.current.get(data.messageId);
            if (pending) {
              clearTimeout(pending.timeoutId);
              pendingRef.current.delete(data.messageId);
              if (pending.type === 'planning') {
                pending.resolve([]);
              } else {
                pending.resolve(null);
              }
            }
          }
          break;

        case 'pong':
          lastPongRef.current = Date.now();
          break;

        case 'warning':
          break;

        default:
          break;
      }
    };

    worker.onerror = (errorEvent) => {
      logger.error('[WebLLM] Worker error:', errorEvent);
      setError(`Worker error: ${errorEvent.message}`);
      setIsModelLoading(false);
      setIsInferring(false);
    };

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      isInitializedRef.current = false;
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

  const _dispatchInference = useCallback(
    async (
      image: ImageBitmap,
      prompt: string,
      inferenceType: InferenceType
    ): Promise<InferenceResult> => {
      if (!workerRef.current || !isModelReady) {
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
      const timeoutMs = inferenceType === 'planning' ? CONFIG.PLANNING_TIMEOUT_MS : CONFIG.INFERENCE_TIMEOUT_MS;
      const defaultValue: InferenceResult = inferenceType === 'planning' ? [] : null;

      return new Promise<InferenceResult>((resolve) => {
        const timeoutId = setTimeout(() => {
          if (pendingRef.current.has(messageId)) {
            pendingRef.current.delete(messageId);
            setError(`${inferenceType === 'planning' ? 'Planning' : inferenceType === 'category' ? 'Category' : 'Inference'} timeout after ${timeoutMs / 1000}s`);
            setErrorCode('INFERENCE_TIMEOUT');
            setIsInferring(false);
            resolve(defaultValue);
          }
        }, timeoutMs);

        pendingRef.current.set(messageId, { type: inferenceType, resolve, timeoutId });

        const payload = {
          type: inferenceType,
          messageId,
          image,
          prompt,
          goal: prompt,
        };

        workerRef.current!.postMessage(payload, [image]);
      });
    },
    [isModelReady]
  );

  const runInference = useCallback(
    async (
      image: ImageBitmap,
      prompt: string
    ): Promise<VisionResponse | null> => {
      const result = await _dispatchInference(image, prompt, 'chat');
      return result as VisionResponse | null;
    },
    [_dispatchInference]
  );

  const runPlanningInference = useCallback(
    async (image: ImageBitmap, goal: string): Promise<TaskStep[]> => {
      const result = await _dispatchInference(image, goal, 'planning');
      return result as TaskStep[];
    },
    [_dispatchInference]
  );

  const runCategoryInference = useCallback(
    async (image: ImageBitmap, goal: string): Promise<VisionResponse | null> => {
      const result = await _dispatchInference(image, goal, 'category');
      return result as VisionResponse | null;
    },
    [_dispatchInference]
  );

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const startHeartbeat = () => {
      heartbeatRef.current = setInterval(() => {
        const timeSinceLastPong = Date.now() - lastPongRef.current;
        
        if (timeSinceLastPong > HEARTBEAT_TIMEOUT_MS) {
          logger.warn('[WebLLM] Worker unresponsive, attempting reconnect...');
          setError('AI Engine Lost - Restarting...');
          setIsModelReady(false);
          reconnectAttemptRef.current += 1;
          
          if (reconnectAttemptRef.current <= 3) {
            worker.terminate();
            isInitializedRef.current = false;
            
            const newWorker = new Worker(new URL('../worker/vision.worker.ts', import.meta.url), {
              type: 'module',
            });
            workerRef.current = newWorker;
            
            setTimeout(() => {
              setError(null);
              initModel();
            }, 1000);
          } else {
            setError('AI Engine recovery failed after 3 attempts');
            setErrorCode('WORKER_INIT_FAILED');
          }
          return;
        }
        
        worker.postMessage({ type: 'ping' });
      }, HEARTBEAT_INTERVAL_MS);
    };

    startHeartbeat();

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [initModel]);

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