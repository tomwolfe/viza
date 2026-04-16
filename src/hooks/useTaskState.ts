'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { safeGet, safeSet, safeRemove, SCHEMA_VERSION } from '@/utils/safeStorage';
import { logger } from '@/config';

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
}

export interface UseTaskStateReturn {
  taskState: TaskState;
  startTask: (taskName: string, steps: TaskStep[]) => void;
  generateTaskPlan: (userGoal: string, sceneImage: ImageBitmap, generatePlanFn: (goal: string, image: ImageBitmap) => Promise<TaskStep[]>) => Promise<void>;
  nextStep: () => void;
  previousStep: () => void;
  completeCurrentStep: () => void;
  resetTask: () => void;
  getCurrentStep: () => TaskStep | null;
  getCurrentInstruction: () => string;
  setSpeak: (speakFn: (text: string) => void) => void;
  isPlanning: boolean;
}

const STORAGE_KEY = 'viza_task_state';

function loadFromStorage(): Partial<TaskState> | null {
  return safeGet<Partial<TaskState>>({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
}

function saveToStorage(state: TaskState): void {
  safeSet(state, { key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
}

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

function getInitialState(): TaskState {
  const stored = loadFromStorage();
  if (stored && stored.taskId && stored.steps && stored.steps.length > 0) {
    return {
      taskId: stored.taskId,
      taskName: stored.taskName || '',
      currentStepIndex: stored.currentStepIndex || 0,
      steps: stored.steps,
      isActive: stored.isActive ?? false,
      completed: stored.completed ?? false,
    };
  }
  return {
    taskId: null,
    taskName: '',
    currentStepIndex: 0,
    steps: [],
    isActive: false,
    completed: false,
  };
}

export function useTaskState(): UseTaskStateReturn {
  const [taskState, setTaskState] = useState<TaskState>(getInitialState);
  const [isPlanning, setIsPlanning] = useState(false);
  const speakRef = useRef<((text: string) => void) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveToStorage(taskState);
  }, [taskState]);

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
    setTaskState({
      taskId: `task-${Date.now()}`,
      taskName,
      currentStepIndex: 0,
      steps,
      isActive: true,
      completed: false,
    });

    if (steps.length > 0 && speakRef.current) {
      speakRef.current(steps[0].instruction);
    }
  }, []);

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
    setTaskState((prev) => {
      if (prev.currentStepIndex >= prev.steps.length - 1) {
        return { ...prev, completed: true, isActive: false };
      }

      const newIndex = prev.currentStepIndex + 1;
      const nextInstruction = prev.steps[newIndex]?.instruction || '';

      if (speakRef.current && nextInstruction) {
        speakRef.current(nextInstruction);
      }

      return {
        ...prev,
        currentStepIndex: newIndex,
      };
    });
  }, []);

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
  }, []);

  const completeCurrentStep = useCallback(() => {
    nextStep();
  }, [nextStep]);

  const resetTask = useCallback(() => {
    setTaskState({
      taskId: null,
      taskName: '',
      currentStepIndex: 0,
      steps: [],
      isActive: false,
      completed: false,
    });
    safeRemove({ key: STORAGE_KEY });
  }, []);

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
  };
}
