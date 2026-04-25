'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useVizaOrchestrator } from '@/contexts/VizaOrchestratorContext';
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
  _initModel: () => void
): UseTaskOrchestratorResult {
  const { isCleaningIntent } = useVoiceIntent();

  const {
    isModelReady,
    runPlanningInference,
  } = useVizaOrchestrator();

  const taskStateResult = useTaskState();

  const {
    taskState,
    generateTaskPlan,
    getCurrentInstruction,
    setSpeak,
    isPlanning,
    checkTargetFound,
  } = taskStateResult;

  const generatePlanFromGoal = useCallback(async (goal: string, _image: ImageBitmap, signal?: AbortSignal): Promise<TaskStep[]> => {
    const sceneImage = sceneImageRef.current;
    if (!sceneImage) {
      logger.warn('[TaskOrchestrator] No scene image available for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }

    try {
      const steps = await runPlanningInference(sceneImage, goal, signal);
      if (steps && steps.length > 0) {
        return steps;
      }
    } catch (error) {
      logger.error('[TaskOrchestrator] Planning inference failed:', error);
    }
    return DEFAULT_ASSEMBLY_TASK;
  }, [runPlanningInference, sceneImageRef]);

  const triggerPlanningMode = useCallback(async (userGoal: string) => {
    if (!isModelReady || isPlanning) return;

    const sceneImage = sceneImageRef.current;
    if (!sceneImage) {
      logger.warn('[TaskOrchestrator] Triggering planning without scene image');
    }

    await generateTaskPlan(userGoal, sceneImage!, generatePlanFromGoal);
  }, [isModelReady, isPlanning, generateTaskPlan, generatePlanFromGoal, sceneImageRef]);

  const speakRef = useRef<((text: string) => void) | null>(null);

  const {
    isListening,
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    error: voiceError,
    errorCode: voiceErrorCode,
  } = useVoice(() => {});

  useEffect(() => {
    speakRef.current = speak;
    setSpeak(speak);
  }, [speak, setSpeak]);

  const handleTranscriptReady = useCallback((transcript: string) => {
    if (!isModelReady) {
      speakRef.current?.("I'm still preparing the AI model. Please wait a moment.");
      logger.warn(`[TaskOrchestrator] Transcript received but model not ready: "${transcript}"`);
      return;
    }

    if (taskState.isActive) {
      return;
    }

    if (isCleaningIntent(transcript)) {
      logger.info(`[TaskOrchestrator] Cleaning intent matched for: "${transcript}"`);
      triggerPlanningMode(transcript);
      return;
    }
  }, [isModelReady, taskState, triggerPlanningMode, isCleaningIntent]);

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