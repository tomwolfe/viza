'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useVoice } from '@/hooks/useVoice';
import { useWebXR } from '@/hooks/useWebXR';
import { useTaskState, DEFAULT_ASSEMBLY_TASK, type TaskStep } from '@/hooks/useTaskState';
import { useVoiceIntent } from '@/hooks/useVoiceIntent';
import type { DetectedObject } from '@/schemas/vision';
import { logger } from '@/config';

export function useAROrchestrator() {
  const [isARActive, setIsARActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [isXRMode, setIsXRMode] = useState(false);

  const { isCleaningIntent } = useVoiceIntent();

  const {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    initModel,
    runInference,
    runPlanningInference,
    error: llmError,
    errorCode: llmErrorCode,
    lastCompleted,
  } = useWebLLM();

  const webXR = useWebXR();

  const {
    taskState,
    startTask,
    generateTaskPlan,
    completeCurrentStep,
    getCurrentInstruction,
    setSpeak,
    isPlanning,
    checkTargetFound,
  } = useTaskState();

  const sceneImageRef = useRef<ImageBitmap | null>(null);
  const voiceCommandRef = useRef<string | null>(null);

  const generatePlanFromGoal = useCallback(async (goal: string): Promise<TaskStep[]> => {
    const sceneImage = sceneImageRef.current;
    if (!sceneImage) {
      logger.warn('[Orchestrator] No scene image available for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }

    try {
      const steps = await runPlanningInference(sceneImage, goal);
      if (steps && steps.length > 0) {
        return steps;
      }
    } catch (error) {
      logger.error('[Orchestrator] Planning inference failed:', error);
    }
    return DEFAULT_ASSEMBLY_TASK;
  }, [runPlanningInference]);

  const triggerPlanningMode = useCallback(async (userGoal: string) => {
    if (!isModelReady || isPlanning) return;

    // Use current frame if available, otherwise planning will use default task
    const sceneImage = sceneImageRef.current;
    if (!sceneImage) {
      logger.warn('[Orchestrator] Triggering planning without scene image');
    }

    await generateTaskPlan(userGoal, sceneImage!, generatePlanFromGoal);
  }, [isModelReady, isPlanning, generateTaskPlan, generatePlanFromGoal]);

  const handleTranscriptReady = useCallback((transcript: string) => {
    voiceCommandRef.current = transcript;

    if (isModelReady && !taskState.isActive) {
      if (isCleaningIntent(transcript)) {
        triggerPlanningMode(transcript);
        voiceCommandRef.current = null;
        return;
      }
    }

    voiceCommandRef.current = null;
  }, [isModelReady, taskState.isActive, triggerPlanningMode, isCleaningIntent]);

  const {
    isListening,
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    error: voiceError,
    errorCode: voiceErrorCode,
  } = useVoice(handleTranscriptReady);

  useEffect(() => {
    setSpeak(speak);
  }, [speak, setSpeak]);

  const handleStartAR = useCallback(async () => {
    try {
      if (!isModelReady) {
        initModel();
      }

      // Try XR session first
      if (webXR.isSupported) {
        const xrSuccess = await webXR.startSession();
        if (xrSuccess) {
          setIsXRMode(true);
        }
      }

      startTask('Assembly Task', DEFAULT_ASSEMBLY_TASK);
      setIsARActive(true);
      setError(null);
    } catch (err) {
      logger.error('Failed to start AR:', err);
      setError('Failed to start AR session. Please refresh and try again.');
    }
  }, [isModelReady, initModel, startTask, webXR]);

  const handleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleObjectsDetected = useCallback((objects: DetectedObject[]) => {
    setDetectedObjects(objects);
  }, []);

  useEffect(() => {
    if (llmError) {
      logger.error('[Orchestrator] WebLLM Error:', llmError);
    }
  }, [llmError]);

  useEffect(() => {
    if (voiceError) {
      logger.warn('[Orchestrator] Voice Error:', voiceError);
    }
  }, [voiceError]);

  useEffect(() => {
    if (lastCompleted && taskState.isActive && !taskState.completed) {
      completeCurrentStep();
    }
  }, [lastCompleted, taskState.isActive, taskState.completed, completeCurrentStep]);

  const currentInstruction = getCurrentInstruction();

// Prioritize errors: Orchestrator > XR > LLM > Voice
const unifiedError = error || webXR.errorMessage || llmError || voiceError;
const unifiedErrorCode = error 
  ? 'ORCHESTRATOR_ERROR' 
  : webXR.error 
  ? webXR.error 
  : llmErrorCode 
  ? llmErrorCode 
  : voiceErrorCode;

  return {
    isARActive,
    setIsARActive,
    error: unifiedError,
    errorCode: unifiedErrorCode,
    setError,
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    runInference,
    taskState,
    isPlanning,
    checkTargetFound,
    isListening,
    isSpeaking,
    transcript,
    speak,
    voiceError,
    llmError,
    detectedObjects,
    handleStartAR,
    handleVoiceInput,
    handleObjectsDetected,
    currentInstruction,
    voiceCommandRef,
    sceneImageRef,
    isXRMode,
    xrSession: webXR.session,
  };
}
