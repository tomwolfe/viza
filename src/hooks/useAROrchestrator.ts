'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useVoice } from '@/hooks/useVoice';
import { useWebXR } from '@/hooks/useWebXR';
import { useTaskState, DEFAULT_ASSEMBLY_TASK, type TaskStep } from '@/hooks/useTaskState';
import type { DetectedObject } from '@/schemas/vision';
import { logger } from '@/config';

export function useAROrchestrator() {
  const [isARActive, setIsARActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [isXRMode, setIsXRMode] = useState(false);

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
    if (!sceneImageRef.current) {
      logger.warn('[Orchestrator] No scene image available for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }

    try {
      const steps = await runPlanningInference(sceneImageRef.current, goal);
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

    await generateTaskPlan(userGoal, sceneImageRef.current!, generatePlanFromGoal);
  }, [isModelReady, isPlanning, generateTaskPlan, generatePlanFromGoal]);

  const handleTranscriptReady = useCallback((transcript: string) => {
    voiceCommandRef.current = transcript;

    if (isModelReady && !taskState.isActive) {
      const isCleaningGoal = /clean|organize|trash|garbage|mess|fix|help/i.test(transcript);
      if (isCleaningGoal) {
        triggerPlanningMode(transcript);
        voiceCommandRef.current = null;
        return;
      }
    }

    voiceCommandRef.current = null;
  }, [isModelReady, taskState.isActive, triggerPlanningMode]);

  const {
    isListening,
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    error: voiceError,
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

  return {
    isARActive,
    setIsARActive,
    error,
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
