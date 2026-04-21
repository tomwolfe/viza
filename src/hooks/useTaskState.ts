'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { safeRemove, SCHEMA_VERSION } from '@/utils/safeStorage';
import { logger } from '@/config';
import type { DetectedObject } from '@/schemas/vision';
import { useSyncedStorage } from './useSyncedStorage';

export interface TaskStep {
  id: string;
  instruction: string;
  targetObject?: string;
  validationPrompt: string;
}

export interface TaskState {
  taskId: string | null;
  taskName: string;
  currentStepIndex: number;
  steps: TaskStep[];
  isActive: boolean;
  completed: boolean;
  stepStartTime: number;
  lastHintTime: number;
  hintCount: number;
}

export interface UseTaskStateReturn {
  taskState: TaskState;
  startTask: (taskName: string, steps: TaskStep[]) => void;
  generateTaskPlan: (userGoal: string, sceneImage: ImageBitmap, generatePlanFn: (goal: string, image: ImageBitmap, signal?: AbortSignal) => Promise<TaskStep[]>) => Promise<void>;
  nextStep: () => void;
  previousStep: () => void;
  completeCurrentStep: () => void;
  resetTask: () => void;
  getCurrentStep: () => TaskStep | null;
  getCurrentInstruction: () => string;
  setSpeak: (speakFn: (text: string) => void) => void;
  isPlanning: boolean;
  checkTargetFound: (detectedObjects: DetectedObject[]) => void;
  getStallStatus: () => { isStalled: boolean; timeOnStep: number; shouldSuggestHint: boolean };
  triggerHint: (worldMapObjects: { name: string; position?: { x: number; y: number; z: number } }[]) => void;
}

const STORAGE_KEY = 'viza_task_state';
const TASK_SCHEMA_VERSION = 2;

export const DEFAULT_ASSEMBLY_TASK: TaskStep[] = [
  {
    id: 'step-1',
    instruction: 'Find the required tool or component',
    validationPrompt: 'Is the target object visible in the scene? Return completed: true if found.',
  },
  {
    id: 'step-2',
    instruction: 'Position the component for assembly',
    validationPrompt: 'Is the component properly positioned? Return completed: true if ready.',
  },
  {
    id: 'step-3',
    instruction: 'Confirm assembly completion',
    validationPrompt: 'Is the assembly complete? Return completed: true if done.',
  },
];

const INITIAL_TASK_STATE: TaskState = {
  taskId: null,
  taskName: '',
  currentStepIndex: 0,
  steps: [],
  isActive: false,
  completed: false,
  stepStartTime: 0,
  lastHintTime: 0,
  hintCount: 0,
};

const STALL_THRESHOLD_MS = 20000;
const HINT_COOLDOWN_MS = 30000;
const MAX_HINTS_PER_STEP = 3;

export function useTaskState(): UseTaskStateReturn {
  const [taskState, setTaskState] = useSyncedStorage<TaskState>(STORAGE_KEY, {
    defaultValue: INITIAL_TASK_STATE,
    schemaVersion: TASK_SCHEMA_VERSION,
  });

  const [isPlanning, setIsPlanning] = useState(false);
  const speakRef = useRef<((text: string) => void) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const abortPlanning = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
  }, []);

  const setSpeak = useCallback((speakFn: (text: string) => void) => {
    speakRef.current = speakFn;
  }, []);

  const startTask = useCallback((taskName: string, steps: TaskStep[]) => {
    const newState: TaskState = {
      taskId: `task-${Date.now()}`,
      taskName,
      currentStepIndex: 0,
      steps,
      isActive: true,
      completed: false,
      stepStartTime: performance.now(),
      lastHintTime: 0,
      hintCount: 0,
    };
    setTaskState(newState);

    if (steps.length > 0 && speakRef.current) {
      speakRef.current(steps[0].instruction);
    }
  }, [setTaskState]);

  const generateTaskPlan = useCallback(async (
    userGoal: string,
    sceneImage: ImageBitmap,
    generatePlanFn: (goal: string, image: ImageBitmap, signal?: AbortSignal) => Promise<TaskStep[]>
  ) => {
    abortPlanning();
    setIsPlanning(true);
    try {
      const steps = await generatePlanFn(userGoal, sceneImage, abortControllerRef.current?.signal);
      if (steps.length > 0) {
        startTask(userGoal, steps);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.debug('[TaskState] Plan generation aborted');
        return;
      }
      logger.error('[TaskState] Failed to generate task plan:', error);
      startTask('Assembly Task', DEFAULT_ASSEMBLY_TASK);
    } finally {
      setIsPlanning(false);
    }
  }, [startTask, abortPlanning]);

  const getCurrentStep = useCallback((): TaskStep | null => {
    if (!taskState.isActive || taskState.steps.length === 0) {
      return null;
    }
    return taskState.steps[taskState.currentStepIndex] || null;
  }, [taskState]);

  const getCurrentInstruction = useCallback((): string => {
    const step = getCurrentStep();
    return step?.instruction || '';
  }, [getCurrentStep]);

  const nextStep = useCallback(() => {
    if (taskState.currentStepIndex >= taskState.steps.length - 1) {
      setTaskState(prev => ({ ...prev, completed: true, isActive: false }));
    } else {
      const nextInstruction = taskState.steps[taskState.currentStepIndex + 1]?.instruction || '';
      if (speakRef.current && nextInstruction) {
        speakRef.current(nextInstruction);
      }
      setTaskState(prev => ({
        ...prev,
        currentStepIndex: prev.currentStepIndex + 1,
        stepStartTime: performance.now(),
        hintCount: 0,
      }));
    }
  }, [taskState, setTaskState]);

  const previousStep = useCallback(() => {
    setTaskState((prev) => {
      if (prev.currentStepIndex <= 0) {
        return prev;
      }

      const newIndex = prev.currentStepIndex - 1;
      const prevInstruction = prev.steps[newIndex]?.instruction || '';

      if (speakRef.current && prevInstruction) {
        speakRef.current(prevInstruction);
      }

      return {
        ...prev,
        currentStepIndex: newIndex,
      };
    });
  }, [setTaskState]);

  const completeCurrentStep = useCallback(() => {
    nextStep();
  }, [nextStep]);

  const resetTask = useCallback(() => {
    setTaskState(INITIAL_TASK_STATE);
    safeRemove({ key: STORAGE_KEY });
  }, [setTaskState]);

  const checkTargetFound = useCallback((detectedObjects: DetectedObject[]) => {
    if (!taskState.isActive || detectedObjects.length === 0) return;
    
    const currentStep = taskState.steps[taskState.currentStepIndex];
    const targetObject = currentStep?.targetObject;
    
    if (targetObject) {
      const foundTarget = detectedObjects.find(obj =>
        obj.name.toLowerCase().includes(targetObject.toLowerCase())
      );
      
      if (foundTarget) {
        nextStep();
      }
    }
  }, [taskState, nextStep]);

  const getStallStatus = useCallback(() => {
    if (!taskState.isActive || taskState.completed) {
      return { isStalled: false, timeOnStep: 0, shouldSuggestHint: false };
    }

    const timeOnStep = performance.now() - taskState.stepStartTime;
    const isStalled = timeOnStep > STALL_THRESHOLD_MS;
    const timeSinceLastHint = performance.now() - taskState.lastHintTime;
    const shouldSuggestHint = isStalled && 
      timeSinceLastHint > HINT_COOLDOWN_MS && 
      taskState.hintCount < MAX_HINTS_PER_STEP;

    return { isStalled, timeOnStep, shouldSuggestHint };
  }, [taskState]);

  const triggerHint = useCallback((worldMapObjects: { name: string; position?: { x: number; y: number; z: number } }[]) => {
    if (!taskState.isActive) return;

    const currentStep = taskState.steps[taskState.currentStepIndex];
    if (!currentStep) return;

    const targetObject = currentStep.targetObject;
    let hintText = '';

    if (targetObject) {
      const knownObjects = worldMapObjects.filter(obj => 
        obj.name.toLowerCase().includes(targetObject.toLowerCase())
      );

      if (knownObjects.length > 0) {
        const lastSeen = knownObjects[0].position;
        if (lastSeen) {
          const directions = [
            { x: 1, label: 'right' },
            { x: -1, label: 'left' },
            { y: 1, label: 'above' },
            { y: -1, label: 'below' },
            { z: 1, label: 'behind' },
            { z: -1, label: 'in front of' },
          ];

          const relativeDir = directions.find(d => 
            d.x && lastSeen.x && Math.sign(lastSeen.x) === Math.sign(d.x) ||
            d.y && lastSeen.y && Math.sign(lastSeen.y) === Math.sign(d.y) ||
            d.z && lastSeen.z && Math.sign(lastSeen.z) === Math.sign(d.z)
          )?.label || 'nearby';

          const dist = Math.sqrt(
            (lastSeen.x || 0) ** 2 + 
            (lastSeen.y || 0) ** 2 + 
            (lastSeen.z || 0) ** 2
          );
          
          hintText = `I detected the ${targetObject} ${relativeDir}. It's about ${dist.toFixed(1)} meters away. Try looking around.`;
        } else {
          hintText = `I remember seeing the ${targetObject} earlier. Try looking around the room.`;
        }
      } else {
        hintText = `I haven't detected the ${targetObject} yet. Try scanning the room slowly or adjusting the lighting.`;
      }
    } else {
      hintText = "Take your time. Look around the room and let me know when you find something.";
    }

    if (speakRef.current) {
      speakRef.current(hintText);
    }

    setTaskState(prev => ({
      ...prev,
      lastHintTime: performance.now(),
      hintCount: prev.hintCount + 1,
    }));
  }, [taskState, setTaskState]);

  return {
    taskState,
    startTask,
    generateTaskPlan,
    nextStep,
    previousStep,
    completeCurrentStep,
    resetTask,
    getCurrentStep,
    getCurrentInstruction,
    setSpeak,
    isPlanning,
    checkTargetFound,
    getStallStatus,
    triggerHint,
  };
}
