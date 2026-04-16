'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useVoice } from '@/hooks/useVoice';
import { useTaskState, DEFAULT_ASSEMBLY_TASK, type TaskStep } from '@/hooks/useTaskState';
import type { DetectedObject } from '@/schemas/vision';
import { logger } from '@/config';

interface UseARSessionOptions {
  isModelReady: boolean;
  runPlanningInference?: (image: ImageBitmap, goal: string) => Promise<TaskStep[]>;
}

interface UseARSessionReturn {
  isARActive: boolean;
  detectedObjects: DetectedObject[];
  voiceCommand: string | null;
  taskState: ReturnType<typeof useTaskState> extends () => infer R ? R : never;
  currentInstruction: string | null;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  speakingText: string | null;
  voiceError: string | null;
  startAR: () => void;
  stopAR: () => void;
  toggleVoiceInput: () => void;
  handleObjectsDetected: (objects: DetectedObject[]) => void;
}

export function useARSession({
  isModelReady,
  runPlanningInference,
}: UseARSessionOptions): UseARSessionReturn {
  const [isARActive, setIsARActive] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [voiceCommand, setVoiceCommand] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const sceneImageRef = useRef<ImageBitmap | null>(null);

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

  const handleTranscriptReady = useCallback((transcript: string) => {
    setVoiceCommand(transcript);
  }, []);

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

  const startAR = useCallback(() => {
    if (!isModelReady) {
      logger.warn('[ARSession] Cannot start AR - model not ready');
      return;
    }
    startTask('Assembly Task', DEFAULT_ASSEMBLY_TASK);
    setIsARActive(true);
  }, [isModelReady, startTask]);

  const stopAR = useCallback(() => {
    setIsARActive(false);
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleObjectsDetected = useCallback((objects: DetectedObject[]) => {
    setDetectedObjects(objects);
  }, []);

  const generatePlanFromGoal = useCallback(async (goal: string): Promise<TaskStep[]> => {
    if (!sceneImageRef.current || !runPlanningInference) {
      logger.warn('[ARSession] No scene image for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }

    try {
      const steps = await runPlanningInference(sceneImageRef.current!, goal);
      if (steps && steps.length > 0) {
        return steps;
      }
    } catch (error) {
      logger.error('[ARSession] Planning failed:', error);
    }
    return DEFAULT_ASSEMBLY_TASK;
  }, [runPlanningInference]);

  const triggerPlanningMode = useCallback(async (userGoal: string) => {
    if (!isModelReady || isPlanning) return;
    if (!sceneImageRef.current) {
      logger.warn('[ARSession] No scene image for planning mode');
      return;
    }
    await generateTaskPlan(userGoal, sceneImageRef.current, generatePlanFromGoal);
  }, [isModelReady, isPlanning, generateTaskPlan, generatePlanFromGoal]);

  useEffect(() => {
    if (voiceCommand && isModelReady) {
      const isCleaningGoal = /clean|organize|trash|garbage|mess|fix|help/i.test(voiceCommand);
      if (isCleaningGoal && !taskState.isActive) {
        triggerPlanningMode(voiceCommand);
      } else {
        setVoiceCommand(null);
      }
    }
  }, [voiceCommand, isModelReady, taskState.isActive, triggerPlanningMode]);

  const currentInstruction = getCurrentInstruction();

  return {
    isARActive,
    detectedObjects,
    voiceCommand,
    taskState: {
      ...taskState,
      isActive: taskState.isActive,
      currentStepIndex: taskState.currentStepIndex,
      steps: taskState.steps,
      completed: taskState.completed,
      isPlanning,
    } as ReturnType<typeof useTaskState> extends () => infer R ? R : never,
    currentInstruction,
    isListening,
    isSpeaking,
    transcript,
    speakingText,
    voiceError,
    startAR,
    stopAR,
    toggleVoiceInput,
    handleObjectsDetected,
  };
}