'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useARSessionManager } from './useARSessionManager';
import { useARStateMachine, type ARState } from './useARStateMachine';
import { useTaskOrchestrator } from './useTaskOrchestrator';
import { useWorldMap, type WorldObject } from './useWorldMap';
import { useVizaError } from '@/contexts/VizaErrorContext';
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
    unifiedError, 
    unifiedErrorCode, 
    setError: setVizaError 
  } = useVizaError();

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
  } = useARSessionManager();

  const { state: arState, dispatchActions } = useARStateMachine();

  const sceneImageRef = useRef<ImageBitmap | null>(null);

  const taskOrchestrator = useTaskOrchestrator(sceneImageRef, () => {
    dispatchActions.initModel();
  });

  const handleStartAR = useCallback(async () => {
    dispatchActions.initModel();
    webllmInitModel();
    await startAR();
  }, [startAR, dispatchActions, webllmInitModel]);

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
    if (llmError && llmErrorCode) {
      setVizaError(llmErrorCode, llmError);
    }
  }, [llmError, llmErrorCode, setVizaError]);

  useEffect(() => {
    if (xrError && xrErrorCode) {
      setVizaError(xrErrorCode, xrError);
    }
  }, [xrError, xrErrorCode, setVizaError]);

  useEffect(() => {
    if (taskOrchestrator.voiceError && taskOrchestrator.voiceErrorCode) {
      setVizaError(taskOrchestrator.voiceErrorCode as VizaErrorCode, taskOrchestrator.voiceError);
    }
  }, [taskOrchestrator.voiceError, taskOrchestrator.voiceErrorCode, setVizaError]);

  useEffect(() => {
    if (arState.type === 'error') {
      const error = (arState as any).error;
      const errorCode = (arState as any).errorCode;
      if (errorCode) {
        setVizaError(errorCode, error);
      }
    }
  }, [arState, setVizaError]);

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
    voiceCommandRef: { current: null }, // Mocked as it seems unused in provided snippet
    sceneImageRef,
    isXRMode,
    xrSession,
  };
}
