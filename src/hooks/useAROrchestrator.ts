'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useARSessionManager } from './useARSessionManager';
import { useARStateMachine, type ARState } from './useARStateMachine';
import { useTaskOrchestrator } from './useTaskOrchestrator';
import { useWorldMap, type WorldObject } from './useWorldMap';
import type { DetectedObject, VisionResponse } from '@/schemas/vision';
import type { TaskStep } from '@/hooks/useTaskState';
import type { VizaErrorCode } from '@/types/worker';
import { logger } from '@/config';

type ARStateType = ARState['type'];

interface UseAROrchestratorResult {
  arState: ARState;
  isARActive: boolean;
  isModelLoading: boolean;
  modelProgress: number;
  isModelReady: boolean;
  isInferring: boolean;
  isDeviceCompatible: boolean;
  runInference: (image: ImageBitmap, prompt: string) => Promise<VisionResponse | null>;
  taskState: {
    isActive: boolean;
    completed: boolean;
    currentStepIndex: number;
    steps: TaskStep[];
  };
  isPlanning: boolean;
  checkTargetFound: (detectedObjects: DetectedObject[]) => void;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  speak: (text: string) => void;
  voiceError: string | null;
  llmError: string | null;
  error: string | null;
  errorCode: VizaErrorCode | null;
  handleStartAR: () => Promise<void>;
  handleVoiceInput: () => void;
  handleObjectsDetected: (objects: DetectedObject[]) => void;
  currentInstruction: string | null;
  dispatchActions: {
    initModel: () => void;
    startInferencing: () => void;
    stopInferencing: () => void;
    startPlanning: () => void;
    stopPlanning: () => void;
    completeStep: () => void;
    handleError: (error: string, errorCode: string | null) => void;
    reset: () => void;
  };
  detectedObjects: DetectedObject[];
  worldMap: WorldObject[];
  addOrUpdateObject: (obj: DetectedObject, position: import('three').Vector3) => void;
  clearWorldMap: () => void;
  voiceCommandRef: { current: string | null };
  sceneImageRef: { current: ImageBitmap | null };
  isXRMode: boolean;
  xrSession: XRSession | null;
}

export function useAROrchestrator(): UseAROrchestratorResult {
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const { worldMap, addOrUpdateObject, clearWorldMap } = useWorldMap();

  const {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    initModel: webllmInitModel,
    runInference,
    error: llmError,
    errorCode: llmErrorCode,
    lastCompleted,
  } = useWebLLM();

  const {
    isARActive,
    isXRMode,
    xrSession,
    error: xrError,
    errorCode: xrErrorCode,
    startAR,
    stopAR,
  } = useARSessionManager();

  const { state: arState, dispatchActions } = useARStateMachine();

  const sceneImageRef = useRef<ImageBitmap | null>(null);
  const voiceCommandRef = useRef<string | null>(null);

  const taskOrchestrator = useTaskOrchestrator(sceneImageRef, () => {
    dispatchActions.initModel();
  });

  const handleStartAR = useCallback(async () => {
    dispatchActions.initModel();
    await startAR();
  }, [startAR, dispatchActions]);

  const handleVoiceInput = useCallback(() => {
    if (taskOrchestrator.isListening) {
      taskOrchestrator.stopListening?.();
    } else {
      taskOrchestrator.startListening?.();
    }
  }, [taskOrchestrator]);

  const handleObjectsDetected = useCallback((objects: DetectedObject[]) => {
    setDetectedObjects(objects);
  }, []);

  useEffect(() => {
    if (llmError) {
      logger.error('[Orchestrator] WebLLM Error:', llmError);
    }
  }, [llmError, logger]);

  useEffect(() => {
    return () => {
      if (sceneImageRef.current) {
        sceneImageRef.current.close();
        sceneImageRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (lastCompleted && taskOrchestrator.taskState.isActive && !taskOrchestrator.taskState.completed) {
      dispatchActions.completeStep();
    }
  }, [lastCompleted, taskOrchestrator.taskState, dispatchActions]);

  useEffect(() => {
    if (arState.type === 'error') {
      logger.error('[Orchestrator] AR State Error:', arState.error);
    }
  }, [arState, logger]);

  const arError = arState.type === 'error' && 'error' in arState ? (arState as ARState & { error: string }).error : null;
  const arErrorCode = arState.type === 'error' && 'errorCode' in arState ? (arState as ARState & { errorCode: VizaErrorCode | null }).errorCode : null;
  const unifiedError = xrError || llmError || taskOrchestrator.voiceError || arError || null;
  const unifiedErrorCode = xrErrorCode || llmErrorCode || arErrorCode || null;

  return {
    arState,
    isARActive,
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    runInference,
    taskState: taskOrchestrator.taskState,
    isPlanning: taskOrchestrator.isPlanning,
    checkTargetFound: taskOrchestrator.checkTargetFound,
    isListening: taskOrchestrator.isListening,
    isSpeaking: taskOrchestrator.isSpeaking,
    transcript: taskOrchestrator.transcript,
    speak: taskOrchestrator.speak,
    voiceError: taskOrchestrator.voiceError,
    llmError,
    error: unifiedError,
    errorCode: unifiedErrorCode,
    handleStartAR,
    handleVoiceInput,
    handleObjectsDetected,
    currentInstruction: taskOrchestrator.currentInstruction,
    dispatchActions,
    detectedObjects,
    worldMap,
    addOrUpdateObject,
    clearWorldMap,
    voiceCommandRef,
    sceneImageRef,
    isXRMode,
    xrSession,
  };
}