'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useVizaError } from '@/contexts/VizaErrorContext';
import type { VisionResponse, TaskStep } from '@/schemas/vision';
import { logger } from '@/config';
import { parseVisionResponse, parsePlanningResponse } from '@/schemas/vision';
import type { VizaErrorCode } from '@/types/worker';
import { useWebLLMWorker } from '@/hooks/useWebLLMWorker';

type InferenceResult = VisionResponse | null | TaskStep[] | { isCompleted: boolean; confidence: number };

type InferenceType = 'chat' | 'planning' | 'category' | 'verification';

export interface WebLLMContextValue {
  isModelReady: boolean;
  isInferring: boolean;
  isDeviceCompatible: boolean;
  isARActive?: boolean;
  initModel: () => Promise<void>;
  runInference: (image: ImageBitmap, prompt: string) => Promise<VisionResponse | null>;
  runPlanningInference: (image: ImageBitmap, goal: string, signal?: AbortSignal) => Promise<TaskStep[]>;
  runCategoryInference: (image: ImageBitmap, goal: string) => Promise<VisionResponse | null>;
  runVerificationInference: (image: ImageBitmap, validationPrompt: string, targetObject: string) => Promise<{ isCompleted: boolean; confidence: number } | null>;
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
  const { setError: setVizaError } = useVizaError();
  const {
    isInferring,
    isDeviceCompatible,
    error,
    errorCode,
    workerClient,
    isModelReady,
    initModel,
    dispose,
    setIsInferring,
  } = useWebLLMWorker({ modelId });

  const [lastCompleted, setLastCompleted] = useState(false);

  const dispatchInference = useCallback(
    async (
      image: ImageBitmap,
      prompt: string,
      inferenceType: InferenceType,
      signal?: AbortSignal
    ): Promise<InferenceResult> => {
      if (!isModelReady) {
        setVizaError('MODEL_NOT_READY', 'Model not ready. Call initModel first.');
        return inferenceType === 'planning' ? [] : null;
      }

      const client = workerClient;
      if (!client) {
        setVizaError('WORKER_INIT_FAILED', 'Worker not initialized');
        return inferenceType === 'planning' ? [] : null;
      }

      setIsInferring(true);
      // We don't clear error here as we want to keep it until next success or explicit clear

      const messageId = crypto.randomUUID();

      try {
        const infPromise = inferenceType === 'planning'
          ? client.planning(image, prompt, messageId, signal)
          : inferenceType === 'category'
          ? client.category(image, prompt, messageId, signal)
          : inferenceType === 'verification'
          ? client.verification(image, prompt, '', messageId, signal)
          : client.chat(image, prompt, messageId, signal);

        const response = await infPromise;

        if (inferenceType === 'planning') {
          const validated = parsePlanningResponse(response);
          return validated?.taskSteps ?? [];
        } else if (inferenceType === 'verification') {
          return response as { isCompleted: boolean; confidence: number };
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
          setVizaError('INFERENCE_ERROR', errorMessage);
        }
        return inferenceType === 'planning' ? [] : inferenceType === 'verification' ? { isCompleted: false, confidence: 0 } : null;
      } finally {
        setIsInferring(false);
      }
    },
    [isModelReady, workerClient, setIsInferring, setVizaError]
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

  const runVerificationInference = useCallback(
    async (image: ImageBitmap, validationPrompt: string, targetObject: string): Promise<{ isCompleted: boolean; confidence: number } | null> => {
      const result = await dispatchInference(image, validationPrompt, 'verification');
      return result as { isCompleted: boolean; confidence: number } | null;
    },
    [dispatchInference]
  );

  return (
    <WebLLMContext.Provider
      value={{
        isModelReady,
        isInferring,
        isDeviceCompatible,
        initModel,
        runInference,
        runPlanningInference,
        runCategoryInference,
        runVerificationInference,
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
