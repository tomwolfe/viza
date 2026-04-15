'use client';

import { useState, useCallback, useRef } from 'react';

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
  nextStep: () => void;
  previousStep: () => void;
  completeCurrentStep: () => void;
  resetTask: () => void;
  getCurrentStep: () => TaskStep | null;
  getCurrentInstruction: () => string;
  setSpeak: (speakFn: (text: string) => void) => void;
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

export function useTaskState(): UseTaskStateReturn {
  const [taskState, setTaskState] = useState<TaskState>({
    taskId: null,
    taskName: '',
    currentStepIndex: 0,
    steps: [],
    isActive: false,
    completed: false,
  });

  const speakRef = useRef<((text: string) => void) | null>(null);

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
  }, []);

  return {
    taskState,
    startTask,
    nextStep,
    previousStep,
    completeCurrentStep,
    resetTask,
    getCurrentStep,
    getCurrentInstruction,
    setSpeak,
  };
}
