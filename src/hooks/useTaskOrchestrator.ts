'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useVoice } from '@/hooks/useVoice';
import { useTaskState, DEFAULT_ASSEMBLY_TASK, type TaskStep } from '@/hooks/useTaskState';
import { useVoiceIntent } from '@/hooks/useVoiceIntent';
import type { DetectedObject } from '@/schemas/vision';
import { logger } from '@/config';

export interface UseTaskOrchestratorResult {
  taskState: ReturnType<typeof useTaskState>['taskState'];
  isPlanning: boolean;
  checkTargetFound: (detectedObjects: DetectedObject[]) => void;
  triggerPlanningMode: (userGoal: string) => Promise<void>;
  handleTranscriptReady: (transcript: string) => void;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  speak: (text: string) => void;
  currentInstruction: string | null;
  startListening: () => void;
  stopListening: () => void;
  voiceError: string | null;
  voiceErrorCode: string | null;
  completeCurrentStep: () => void;
}

export function useTaskOrchestrator(
  sceneImageRef: React.MutableRefObject<ImageBitmap | null>,
  initModel: () => void
): UseTaskOrchestratorResult {
  const { isCleaningIntent } = useVoiceIntent();

  const {
    isModelReady,
    runPlanningInference,
  } = useWebLLM();

  const taskStateResult = useTaskState();

  const {
    taskState,
    startTask,
    generateTaskPlan,
    completeCurrentStep,
    getCurrentInstruction,
    setSpeak,
    isPlanning,
    checkTargetFound,
  } = taskStateResult;

  const generatePlanFromGoal = useCallback(async (goal: string): Promise<TaskStep[]> => {
    const sceneImage = sceneImageRef.current;
    if (!sceneImage) {
      logger.warn('[TaskOrchestrator] No scene image available for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }

    try {
      const steps = await runPlanningInference(sceneImage, goal);
      if (steps && steps.length > 0) {
        return steps;
      }
    } catch (error) {
      logger.error('[TaskOrchestrator] Planning inference failed:', error);
    }
    return DEFAULT_ASSEMBLY_TASK;
  }, [runPlanningInference]);

  const triggerPlanningMode = useCallback(async (userGoal: string) => {
    if (!isModelReady || isPlanning) return;

    const sceneImage = sceneImageRef.current;
    if (!sceneImage) {
      logger.warn('[TaskOrchestrator] Triggering planning without scene image');
    }

    await generateTaskPlan(userGoal, sceneImage!, generatePlanFromGoal);
  }, [isModelReady, isPlanning, generateTaskPlan, generatePlanFromGoal]);

  const handleTranscriptReady = useCallback((transcript: string) => {
    if (isModelReady && !taskState.isActive) {
      if (isCleaningIntent(transcript)) {
        triggerPlanningMode(transcript);
        return;
      }
    }
  }, [isModelReady, taskState.isActive, triggerPlanningMode, isCleaningIntent]);

  const voiceRef = useRef<((text: string) => void) | null>(null);

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
    if (speak) {
      voiceRef.current = speak;
      setSpeak(speak);
    }
  }, [speak, setSpeak]);

  useEffect(() => {
    if (voiceError) {
      logger.warn('[TaskOrchestrator] Voice Error:', voiceError);
    }
  }, [voiceError]);

  const currentInstruction = getCurrentInstruction();

  return {
    taskState,
    isPlanning,
    checkTargetFound,
    triggerPlanningMode,
    handleTranscriptReady,
    isListening,
    isSpeaking,
    transcript,
    speak,
    currentInstruction,
    startListening,
    stopListening,
    voiceError,
    voiceErrorCode,
    completeCurrentStep: taskStateResult.completeCurrentStep,
  };
}

export function initializeTaskOrchestrator(): void {
  logger.log('[TaskOrchestrator] Initialized');
}