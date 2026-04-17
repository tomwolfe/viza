'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useARSessionManager } from './useARSessionManager';
import { useTaskOrchestrator } from './useTaskOrchestrator';
import { useWorldMap, type WorldObject } from './useWorldMap';
import type { DetectedObject } from '@/schemas/vision';
import { logger } from '@/config';

export function useAROrchestrator() {
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const { worldMap, addOrUpdateObject, clearWorldMap } = useWorldMap();

  const {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    initModel,
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

  const sceneImageRef = useRef<ImageBitmap | null>(null);
  const voiceCommandRef = useRef<string | null>(null);

  const taskOrchestrator = useTaskOrchestrator(sceneImageRef, initModel);

  const handleStartAR = useCallback(async () => {
    await startAR();
  }, [startAR]);

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
      taskOrchestrator.completeCurrentStep?.();
    }
  }, [lastCompleted, taskOrchestrator.taskState.isActive, taskOrchestrator.taskState.completed]);

  const unifiedError = xrError || llmError || taskOrchestrator.voiceError || null;
  const unifiedErrorCode = xrErrorCode || llmErrorCode || null;

  return {
    isARActive,
    error: unifiedError,
    errorCode: unifiedErrorCode,
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
    detectedObjects,
    worldMap,
    addOrUpdateObject,
    clearWorldMap,
    handleStartAR,
    handleVoiceInput,
    handleObjectsDetected,
    currentInstruction: taskOrchestrator.currentInstruction,
    voiceCommandRef,
    sceneImageRef,
    isXRMode,
    xrSession,
  };
}