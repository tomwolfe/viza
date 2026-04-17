'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { VisionResponse, TaskStep } from '@/schemas/vision';
import { logger } from '@/config';
import { parseVisionResponse, parsePlanningResponse } from '@/schemas/vision';
import type { VizaErrorCode } from '@/types/worker';
import { useWebLLMWorker } from '@/hooks/useWebLLMWorker';

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
  runPlanningInference: (image: ImageBitmap, goal: string, signal?: AbortSignal) => Promise<TaskStep[]>;
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
  const {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    error,
    errorCode,
    workerClient,
    isModelReadyRef,
    initModel,
    dispose,
    setIsInferring,
    setError,
    setErrorCode,
  } = useWebLLMWorker({ modelId });

  const [lastCompleted, setLastCompleted] = useState(false);

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

      const client = workerClient;
      if (!client) {
        setError('Worker not initialized');
        return inferenceType === 'planning' ? [] : null;
      }

      setIsInferring(true);
      setError(null);

      const messageId = crypto.randomUUID();

      try {
        const infPromise = inferenceType === 'planning'
          ? client.planning(image, prompt, messageId, signal)
          : inferenceType === 'category'
          ? client.category(image, prompt, messageId, signal)
          : client.chat(image, prompt, messageId, signal);

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
    [isModelReadyRef, workerClient, setIsInferring, setError, setErrorCode]
  );

  const runInference = useCallback(
    async (image: ImageBitmap, prompt: string): Promise<VisionResponse | null> => {
      const result = await dispatchInference(image, prompt, 'chat');
      return result as VisionResponse | null;
    },
    [dispatchInference]
  );

  const runPlanningInference = useCallback(
    async (image: ImageBitmap, goal: string, signal?: AbortSignal): Promise<TaskStep[]> => {
      const result = await dispatchInference(image, goal, 'planning', signal);
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
