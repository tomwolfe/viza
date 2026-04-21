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
  verificationMode?: 'presence' | 'removal' | 'placement';
  requiredConsecutiveDetections?: number;
  confidenceThreshold?: number;
  verificationTimeout?: number;
}

interface DetectionRecord {
  objectName: string;
  timestamp: number;
  wasPresent: boolean;
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
  checkTargetFound: (detectedObjects: DetectedObject[], worldMapPositions?: Map<string, { x: number; y: number; z: number }>) => VerificationResult;
  getStallStatus: () => { isStalled: boolean; timeOnStep: number; shouldSuggestHint: boolean };
  triggerHint: (worldMapObjects: { name: string; position?: { x: number; y: number; z: number } }[]) => void;
  verifyState: () => Promise<VerificationResult>;
  clearDetectionHistory: () => void;
}

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  mode: 'presence' | 'removal' | 'placement' | 'none';
  consecutiveMatches: number;
  missingCount: number;
  message: string;
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
const DEFAULT_CONSECUTIVE_DETECTIONS = 3;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DETECTION_HISTORY_SIZE = 10;
const VERIFICATION_COOLDOWN_MS = 2000;

export function useTaskState(): UseTaskStateReturn {
  const [taskState, setTaskState] = useSyncedStorage<TaskState>(STORAGE_KEY, {
    defaultValue: INITIAL_TASK_STATE,
    schemaVersion: TASK_SCHEMA_VERSION,
  });

  const [isPlanning, setIsPlanning] = useState(false);
  const speakRef = useRef<((text: string) => void) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const detectionHistoryRef = useRef<DetectionRecord[]>([]);
  const consecutiveMatchCountRef = useRef<number>(0);
  const lastVerificationTimeRef = useRef<number>(0);

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
    clearDetectionHistory();
  }, [setTaskState]);

  const verifyState = useCallback(async (): Promise<VerificationResult> => {
    return {
      verified: false,
      confidence: 0,
      mode: 'none',
      consecutiveMatches: consecutiveMatchCountRef.current,
      missingCount: 0,
      message: 'Manual verification requested - check target found to be updated',
    };
  }, []);

  const clearDetectionHistory = useCallback(() => {
    detectionHistoryRef.current = [];
    consecutiveMatchCountRef.current = 0;
    lastVerificationTimeRef.current = 0;
  }, []);

  const checkTargetFound = useCallback((
    detectedObjects: DetectedObject[],
    worldMapPositions?: Map<string, { x: number; y: number; z: number }>
  ): VerificationResult => {
    const result: VerificationResult = {
      verified: false,
      confidence: 0,
      mode: 'none',
      consecutiveMatches: 0,
      missingCount: 0,
      message: '',
    };

    if (!taskState.isActive) {
      return result;
    }

    const currentStep = taskState.steps[taskState.currentStepIndex];
    if (!currentStep) {
      return result;
    }

    const targetObject = currentStep.targetObject;
    const verificationMode = currentStep.verificationMode || 'presence';
    const requiredDetections = currentStep.requiredConsecutiveDetections || DEFAULT_CONSECUTIVE_DETECTIONS;
    const confidenceThreshold = currentStep.confidenceThreshold || DEFAULT_CONFIDENCE_THRESHOLD;

    result.mode = verificationMode;

    if (!targetObject) {
      result.verified = true;
      result.message = 'No target object specified';
      return result;
    }

    const targetLower = targetObject.toLowerCase();
    const foundTarget = detectedObjects.find(obj =>
      obj.name.toLowerCase().includes(targetLower)
    );

    const now = performance.now();
    const timeSinceLastCheck = now - lastVerificationTimeRef.current;
    if (timeSinceLastCheck < VERIFICATION_COOLDOWN_MS && consecutiveMatchCountRef.current > 0) {
      result.consecutiveMatches = consecutiveMatchCountRef.current;
      return result;
    }

    if (verificationMode === 'removal') {
      const worldMapPosition = worldMapPositions?.get(targetLower);
      const wasPreviouslyPresent = worldMapPosition !== undefined;

      if (!foundTarget && wasPreviouslyPresent) {
        const recentHistory = detectionHistoryRef.current.slice(-5);
        const absentCount = recentHistory.filter(r => !r.wasPresent && r.objectName === targetLower).length;

        detectionHistoryRef.current.push({
          objectName: targetLower,
          timestamp: now,
          wasPresent: false,
        });
        detectionHistoryRef.current = detectionHistoryRef.current.slice(-DETECTION_HISTORY_SIZE);

        if (absentCount >= requiredDetections - 1 || !wasPreviouslyPresent) {
          result.verified = true;
          result.confidence = 1.0;
          result.missingCount = absentCount + 1;
          result.message = `Verified: ${targetObject} has been removed`;
          consecutiveMatchCountRef.current = 0;
          nextStep();
        } else {
          result.missingCount = absentCount + 1;
          result.consecutiveMatches = absentCount;
          result.message = `Verifying removal: ${targetObject} not seen for ${absentCount} checks`;
        }
      } else if (foundTarget) {
        result.confidence = foundTarget.confidence || 0.5;
        result.message = `${targetObject} still visible - waiting for removal`;
        consecutiveMatchCountRef.current = 0;
      }
    } else if (verificationMode === 'placement') {
      if (foundTarget) {
        const conf = foundTarget.confidence || 0.5;
        if (conf >= confidenceThreshold) {
          consecutiveMatchCountRef.current += 1;
          result.confidence = conf;
          result.consecutiveMatches = consecutiveMatchCountRef.current;

          if (consecutiveMatchCountRef.current >= requiredDetections) {
            result.verified = true;
            result.message = `Verified: ${targetObject} is properly placed`;
            nextStep();
          } else {
            result.message = `Verifying placement: ${consecutiveMatchCountRef.current}/${requiredDetections} confirmations`;
          }
        }
      } else {
        consecutiveMatchCountRef.current = 0;
        result.message = `${targetObject} not found for placement verification`;
      }
    } else {
      if (foundTarget) {
        const conf = foundTarget.confidence || 0.5;
        if (conf >= confidenceThreshold) {
          consecutiveMatchCountRef.current += 1;
          result.confidence = conf;
          result.consecutiveMatches = consecutiveMatchCountRef.current;

          detectionHistoryRef.current.push({
            objectName: targetLower,
            timestamp: now,
            wasPresent: true,
          });
          detectionHistoryRef.current = detectionHistoryRef.current.slice(-DETECTION_HISTORY_SIZE);

          if (consecutiveMatchCountRef.current >= requiredDetections) {
            result.verified = true;
            result.message = `Verified: ${targetObject} found with ${(conf * 100).toFixed(0)}% confidence`;
            nextStep();
          } else {
            result.message = `Verifying: ${consecutiveMatchCountRef.current}/${requiredDetections} confirmations`;
          }
        } else {
          result.confidence = conf;
          result.message = `Low confidence (${(conf * 100).toFixed(0)}%) - need higher confidence`;
          consecutiveMatchCountRef.current = 0;
        }
      } else {
        result.message = `${targetObject} not detected`;
        consecutiveMatchCountRef.current = 0;
      }
    }

    lastVerificationTimeRef.current = now;
    return result;
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
    verifyState,
    clearDetectionHistory,
  };
}
