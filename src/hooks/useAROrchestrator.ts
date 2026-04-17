'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useARSessionManager } from './useARSessionManager';
import { useARStateMachine, type ARState } from './useARStateMachine';
import { useTaskOrchestrator } from './useTaskOrchestrator';
import { useWorldMap, type WorldObject } from './useWorldMap';
import type { DetectedObject } from '@/schemas/vision';
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
  runInference: (image: ImageBitmap, prompt: string) => Promise<DetectedObject[] | null>;
  taskState: {
    isActive: boolean;
    completed: boolean;
    currentStepIndex: number;
  };
  isPlanning: boolean;
  checkTargetFound: (detectedObjects: DetectedObject[]) => void;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  speak: (text: string) => void;
  voiceError: string | null;
  error: string | null;
  errorCode: string | null;
  handleStartAR: () => Promise<void>;
  handleVoiceInput: () => void;
  handleObjectsDetected: (objects: DetectedObject[]) => void;
  currentInstruction: string;
  dispatchActions: {
    initModel: () => void;
    startInferencing: () => void;
    stopInferencing: () => void;
    startPlanning: () => void;
    stopPlanning: () => void;
    completeStep: () => void;
    handleError: (error: string, errorCode?: string | null) => void;
    reset: () => void;
  };
  worldMap: WorldObject[];
  addOrUpdateObject: (obj: DetectedObject, position: import('three').Vector3) => void;
  clearWorldMap: () => void;
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
  }, [llmError]);

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
  }, [lastCompleted, taskOrchestrator.taskState.isActive, taskOrchestrator.taskState.completed, dispatchActions]);

  useEffect(() => {
    if (arState.type === 'error') {
      const state = arState;
      logger.error('[Orchestrator] AR State Error:', state.error);
    }
  }, [arState]);

  const unifiedError = xrError || llmError || taskOrchestrator.voiceError || (arState.type === 'error' ? (arState as ARState & { error: string }).error : null) || null;
  const unifiedErrorCode = xrErrorCode || llmErrorCode || (arState.type === 'error' ? (arState as ARState & { errorCode: string | null }).errorCode : null) || null;

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
    error: unifiedError,
    errorCode: unifiedErrorCode,
    handleStartAR,
    handleVoiceInput,
    handleObjectsDetected,
    currentInstruction: taskOrchestrator.currentInstruction,
    dispatchActions,
    worldMap,
    addOrUpdateObject,
    clearWorldMap,
    voiceCommandRef,
    sceneImageRef,
    isXRMode,
    xrSession,
  };
}