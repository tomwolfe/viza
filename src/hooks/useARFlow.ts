'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { DEFAULT_ASSEMBLY_TASK, type TaskStep } from '@/hooks/useTaskState';
import { logger } from '@/config';

interface UseARFlowOptions {
  isModelReady: boolean;
  runPlanningInference: (image: ImageBitmap, goal: string) => Promise<TaskStep[]>;
  taskState: {
    isActive: boolean;
    steps: TaskStep[];
    currentStepIndex: number;
  };
  completeCurrentStep: () => void;
  getCurrentInstruction: () => string;
  speak: (text: string) => void;
  setSpeak: (fn: (text: string) => void) => void;
}

export interface UseARFlowReturn {
  detectedObjects: DetectedObject[];
  isPlanning: boolean;
  currentInstruction: string;
  handleObjectsDetected: (objects: DetectedObject[]) => void;
  triggerPlanningMode: (userGoal: string) => Promise<void>;
  sceneImageRef: React.MutableRefObject<ImageBitmap | null>;
  voiceCommand: string | null;
  setVoiceCommand: (cmd: string | null) => void;
}

export function useARFlow({
  isModelReady,
  runPlanningInference,
  taskState,
  completeCurrentStep,
  getCurrentInstruction,
  speak,
  setSpeak,
}: UseARFlowOptions): UseARFlowReturn {
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [voiceCommand, setVoiceCommand] = useState<string | null>(null);
  const sceneImageRef = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    setSpeak(speak);
  }, [speak, setSpeak]);

  const generatePlanFromGoal = useCallback(async (goal: string): Promise<TaskStep[]> => {
    if (!sceneImageRef.current) {
      logger.warn('[ARFlow] No scene image available for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }

    try {
      const steps = await runPlanningInference(sceneImageRef.current, goal);
      if (steps && steps.length > 0) {
        return steps;
      }
    } catch (error) {
      logger.error('[ARFlow] Planning inference failed:', error);
    }
    return DEFAULT_ASSEMBLY_TASK;
  }, [runPlanningInference]);

  const handleObjectsDetected = useCallback((objects: DetectedObject[]) => {
    setDetectedObjects(objects);

    if (taskState.isActive && objects.length > 0) {
      const currentStep = taskState.steps[taskState.currentStepIndex];
      const targetObject = currentStep?.targetObject;

      if (targetObject) {
        const foundTarget = objects.find(obj =>
          obj.name.toLowerCase().includes(targetObject.toLowerCase())
        );

        if (foundTarget) {
          completeCurrentStep();
        }
      }
    }

    const actions = objects
      .filter(obj => obj.action)
      .map(obj => `${obj.name}: ${obj.action}`)
      .join('. ');

    if (actions) {
      speak(actions);
    }
  }, [speak, taskState, completeCurrentStep]);

  const triggerPlanningMode = useCallback(async (userGoal: string) => {
    if (!isModelReady || isPlanning) return;

    setIsPlanning(true);
    try {
      const steps = await generatePlanFromGoal(userGoal);
      logger.info('[ARFlow] Generated plan:', steps);
    } catch (error) {
      logger.error('[ARFlow] Plan generation failed:', error);
    } finally {
      setIsPlanning(false);
    }
  }, [isModelReady, isPlanning, generatePlanFromGoal]);

  useEffect(() => {
    if (voiceCommand && isModelReady) {
      const isCleaningGoal = /clean|organize|trash|garbage|mess|fix|help/i.test(voiceCommand);

      if (isCleaningGoal && !taskState.isActive) {
        triggerPlanningMode(voiceCommand);
      } else {
        setTimeout(() => setVoiceCommand(null), 0);
      }
    }
  }, [voiceCommand, isModelReady, taskState.isActive, triggerPlanningMode]);

  const currentInstruction = getCurrentInstruction();

  return {
    detectedObjects,
    isPlanning,
    currentInstruction,
    handleObjectsDetected,
    triggerPlanningMode,
    sceneImageRef,
    voiceCommand,
    setVoiceCommand,
  };
}