'use client';

import { createContext, useContext, useRef, useCallback, type ReactNode } from 'react';
import { useTaskOrchestrator, type UseTaskOrchestratorResult } from '@/hooks/useTaskOrchestrator';

export interface TaskState {
  isActive: boolean;
  completed: boolean;
  currentStepIndex: number;
  steps: Array<{
    id: string;
    instruction: string;
    targetObject?: string;
    validationPrompt: string;
  }>;
}

export interface TaskContextValue {
  taskState: TaskState;
  isPlanning: boolean;
  checkTargetFound: (detectedObjects: Array<{name: string}>) => void;
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

const TaskContext = createContext<UseTaskOrchestratorResult | null>(null);

export function TaskProvider({ children, webllmInitModel }: {
  children: ReactNode;
  webllmInitModel: () => void;
}) {
  const sceneImageRef = useRef<ImageBitmap | null>(null);

  const orchestrator = useTaskOrchestrator(sceneImageRef, webllmInitModel);

  return (
    <TaskContext.Provider value={orchestrator}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTaskContext() {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error('useTaskContext must be used within a TaskProvider');
  }
  return context;
}

export { TaskContext };
