'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';
import { useVizaError } from '@/contexts/VizaErrorContext';
import { useWebLLMWorker } from '@/hooks/useWebLLMWorker';
import { useWorldMap } from '@/hooks/useWorldMap';
import type { VisionResponse, TaskStep, DetectedObject } from '@/schemas/vision';
import type { WorldObject } from '@/hooks/useWorldMap';
import type { VizaErrorCode } from '@/types/worker';
import { parseVisionResponse, parsePlanningResponse } from '@/schemas/vision';
import { logger } from '@/config';
import * as THREE from 'three';

type InferenceResult = VisionResponse | null | TaskStep[] | { isCompleted: boolean; confidence: number };
type InferenceType = 'chat' | 'planning' | 'category' | 'verification';

export interface VizaOrchestratorContextValue {
  isModelReady: boolean;
  isInferring: boolean;
  isDeviceCompatible: boolean;
  error: string | null;
  errorCode: VizaErrorCode | null;
  lastCompleted: boolean;
  worldMap: WorldObject[];
  detectedObjects: DetectedObject[];
  initModel: () => Promise<void>;
  dispose: () => void;
  runInference: (image: ImageBitmap, prompt: string) => Promise<VisionResponse | null>;
  runPlanningInference: (image: ImageBitmap, goal: string, signal?: AbortSignal) => Promise<TaskStep[]>;
  runCategoryInference: (image: ImageBitmap, goal: string) => Promise<VisionResponse | null>;
  runVerificationInference: (image: ImageBitmap, validationPrompt: string, targetObject: string) => Promise<{ isCompleted: boolean; confidence: number } | null>;
  addOrUpdateObject: (obj: DetectedObject, position: THREE.Vector3) => void;
  clearWorldMap: () => void;
  setDetectedObjects: (objects: DetectedObject[]) => void;
  getDetectedObjects: () => DetectedObject[];
}

const VizaOrchestratorContext = createContext<VizaOrchestratorContextValue | null>(null);

export function VizaOrchestratorProvider({ children, modelId }: { children: ReactNode; modelId?: string }) {
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
  const { worldMap, addOrUpdateObject, clearWorldMap } = useWorldMap();
  const [detectedObjects, setDetectedObjectsState] = useState<DetectedObject[]>([]);
  const detectedObjectsRef = useRef<DetectedObject[]>([]);

  const setDetectedObjects = useCallback((objects: DetectedObject[]) => {
    setDetectedObjectsState(objects);
    detectedObjectsRef.current = objects;
  }, []);

  const getDetectedObjects = useCallback(() => {
    return detectedObjectsRef.current;
  }, []);

  const dispatchInference = useCallback(
    async (
      image: ImageBitmap,
      prompt: string,
      inferenceType: InferenceType,
      signal?: AbortSignal
    ): Promise<InferenceResult> => {
      const client = workerClient;
      if (!isModelReady || !client) {
        try { image.close(); } catch {}
        if (!isModelReady) {
          setVizaError('MODEL_NOT_READY', 'Model not ready. Call initModel first.');
        } else {
          setVizaError('WORKER_INIT_FAILED', 'Worker not initialized');
        }
        return inferenceType === 'planning' ? [] : null;
      }

      setIsInferring(true);
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
          logger.error(`[VizaOrchestrator] ${inferenceType} error:`, err);
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
    <VizaOrchestratorContext.Provider
      value={{
        isModelReady,
        isInferring,
        isDeviceCompatible,
        error,
        errorCode,
        lastCompleted,
        worldMap,
        detectedObjects,
        initModel,
        dispose,
        runInference,
        runPlanningInference,
        runCategoryInference,
        runVerificationInference,
        addOrUpdateObject,
        clearWorldMap,
        setDetectedObjects,
        getDetectedObjects,
      }}
    >
      {children}
    </VizaOrchestratorContext.Provider>
  );
}

export function useVizaOrchestrator() {
  const context = useContext(VizaOrchestratorContext);
  if (!context) {
    throw new Error('useVizaOrchestrator must be used within a VizaOrchestratorProvider');
  }
  return context;
}
