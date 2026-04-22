import type { DetectedObject } from '@/schemas/vision';
import type { TaskStep } from '../hooks/useTaskState';
import { levenshteinDistance, computeLabelSimilarity } from './stringUtils';

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  mode: 'presence' | 'removal' | 'placement' | 'none';
  consecutiveMatches: number;
  missingCount: number;
  message: string;
}

export interface DetectionRecord {
  objectName: string;
  timestamp: number;
  wasPresent: boolean;
}

export interface TaskStateContext {
  isActive: boolean;
  currentStepIndex: number;
  steps: TaskStep[];
}

export interface CheckTargetFoundParams {
  detectedObjects: DetectedObject[];
  worldMapPositions?: Map<string, { x: number; y: number; z: number }>;
  taskState: TaskStateContext;
  consecutiveMatchCount: number;
  lastVerificationTime: number;
  detectionHistory: DetectionRecord[];
}

export interface CheckTargetFoundResult extends VerificationResult {
  newConsecutiveMatchCount: number;
  newLastVerificationTime: number;
  newDetectionHistory: DetectionRecord[];
  shouldAdvanceStep: boolean;
}

export const DEFAULT_CONSECUTIVE_DETECTIONS = 3;
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
export const DETECTION_HISTORY_SIZE = 10;
export const VERIFICATION_COOLDOWN_MS = 2000;

function levenshteinDistanceForTask(a: string, b: string): number {
  return levenshteinDistance(a, b);
}

function computeLabelSimilarityFromTask(name1: string, name2: string): number {
  return computeLabelSimilarity(name1, name2);
}

export function checkTargetFound(params: CheckTargetFoundParams): CheckTargetFoundResult {
  const { detectedObjects, worldMapPositions, taskState, consecutiveMatchCount, lastVerificationTime, detectionHistory } = params;

  const result: CheckTargetFoundResult = {
    verified: false,
    confidence: 0,
    mode: 'none',
    consecutiveMatches: consecutiveMatchCount,
    missingCount: 0,
    message: '',
    newConsecutiveMatchCount: consecutiveMatchCount,
    newLastVerificationTime: lastVerificationTime,
    newDetectionHistory: detectionHistory,
    shouldAdvanceStep: false,
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
  const timeSinceLastCheck = now - lastVerificationTime;

  let newConsecutiveMatchCount = consecutiveMatchCount;
  let newDetectionHistory = [...detectionHistory];

  if (timeSinceLastCheck < VERIFICATION_COOLDOWN_MS && consecutiveMatchCount > 0) {
    result.consecutiveMatches = consecutiveMatchCount;
    return result;
  }

  if (verificationMode === 'removal') {
    const worldMapPosition = worldMapPositions?.get(targetLower);
    const wasPreviouslyPresent = worldMapPosition !== undefined;

    if (!foundTarget && wasPreviouslyPresent) {
      const recentHistory = newDetectionHistory.slice(-5);
      const absentCount = recentHistory.filter(r => !r.wasPresent && r.objectName === targetLower).length;

      newDetectionHistory.push({
        objectName: targetLower,
        timestamp: now,
        wasPresent: false,
      });
      newDetectionHistory = newDetectionHistory.slice(-DETECTION_HISTORY_SIZE);

      if (absentCount >= requiredDetections - 1 || !wasPreviouslyPresent) {
        result.verified = true;
        result.confidence = 1.0;
        result.missingCount = absentCount + 1;
        result.message = `Verified: ${targetObject} has been removed`;
        newConsecutiveMatchCount = 0;
        result.shouldAdvanceStep = true;
      } else {
        result.missingCount = absentCount + 1;
        result.consecutiveMatches = absentCount;
        result.message = `Verifying removal: ${targetObject} not seen for ${absentCount} checks`;
      }
    } else if (foundTarget) {
      result.confidence = foundTarget.confidence || 0.5;
      result.message = `${targetObject} still visible - waiting for removal`;
      newConsecutiveMatchCount = 0;
    }
  } else if (verificationMode === 'placement') {
    if (foundTarget) {
      const conf = foundTarget.confidence || 0.5;
      if (conf >= confidenceThreshold) {
        newConsecutiveMatchCount += 1;
        result.confidence = conf;
        result.consecutiveMatches = newConsecutiveMatchCount;

        if (newConsecutiveMatchCount >= requiredDetections) {
          result.verified = true;
          result.message = `Verified: ${targetObject} is properly placed`;
          result.shouldAdvanceStep = true;
        } else {
          result.message = `Verifying placement: ${newConsecutiveMatchCount}/${requiredDetections} confirmations`;
        }
      }
    } else {
      newConsecutiveMatchCount = 0;
      result.message = `${targetObject} not found for placement verification`;
    }
  } else {
    if (foundTarget) {
      const conf = foundTarget.confidence || 0.5;
      if (conf >= confidenceThreshold) {
        newConsecutiveMatchCount += 1;
        result.confidence = conf;
        result.consecutiveMatches = newConsecutiveMatchCount;

        newDetectionHistory.push({
          objectName: targetLower,
          timestamp: now,
          wasPresent: true,
        });
        newDetectionHistory = newDetectionHistory.slice(-DETECTION_HISTORY_SIZE);

        if (newConsecutiveMatchCount >= requiredDetections) {
          result.verified = true;
          result.message = `Verified: ${targetObject} found with ${(conf * 100).toFixed(0)}% confidence`;
          result.shouldAdvanceStep = true;
        } else {
          result.message = `Verifying: ${newConsecutiveMatchCount}/${requiredDetections} confirmations`;
        }
      } else {
        result.confidence = conf;
        result.message = `Low confidence (${(conf * 100).toFixed(0)}%) - need higher confidence`;
        newConsecutiveMatchCount = 0;
      }
    } else {
      result.message = `${targetObject} not detected`;
      newConsecutiveMatchCount = 0;
    }
  }

  result.newConsecutiveMatchCount = newConsecutiveMatchCount;
  result.newLastVerificationTime = now;
  result.newDetectionHistory = newDetectionHistory;

  return result;
}

export interface VerifyStateParams {
  taskState: TaskStateContext;
  image?: ImageBitmap;
  runVerificationInference?: (image: ImageBitmap, validationPrompt: string, targetObject: string) => Promise<{ isCompleted: boolean; confidence: number } | null>;
}

export interface VerifyStateResult extends VerificationResult {
  newVlmFailureCount: number;
  newConsecutiveMatchCount: number;
  shouldAdvanceStep: boolean;
  shouldTriggerCorrection: boolean;
}

export const VLM_VERIFICATION_CONFIDENCE_THRESHOLD = 0.75;
export const VLM_FAILED_VERIFICATION_THRESHOLD = 3;

export async function verifyState(
  params: VerifyStateParams,
  getCurrentStep: () => TaskStep | null,
  advanceStep: () => void,
  currentVlmFailureCount: number,
  currentConsecutiveMatchCount: number
): Promise<VerifyStateResult> {
  const { taskState, image, runVerificationInference } = params;
  
  const result: VerifyStateResult = {
    verified: false,
    confidence: 0,
    mode: 'none',
    consecutiveMatches: currentConsecutiveMatchCount,
    missingCount: 0,
    message: '',
    newVlmFailureCount: currentVlmFailureCount,
    newConsecutiveMatchCount: currentConsecutiveMatchCount,
    shouldAdvanceStep: false,
    shouldTriggerCorrection: false,
  };

  const currentStep = getCurrentStep();
  
  if (!currentStep || !taskState.isActive) {
    result.message = 'No active task step';
    return result;
  }

  if (!image || !runVerificationInference) {
    result.message = 'VLM verification requires image and inference function';
    return result;
  }

  try {
    const inferenceResult = await runVerificationInference(
      image,
      currentStep.validationPrompt,
      currentStep.targetObject || ''
    );

    if (!inferenceResult) {
      result.message = 'VLM verification inference failed';
      return result;
    }

    if (inferenceResult.isCompleted && inferenceResult.confidence >= VLM_VERIFICATION_CONFIDENCE_THRESHOLD) {
      result.newVlmFailureCount = 0;
      result.newConsecutiveMatchCount = currentConsecutiveMatchCount + 1;
      
      result.verified = true;
      result.confidence = inferenceResult.confidence;
      result.mode = currentStep.verificationMode || 'presence';
      result.consecutiveMatches = result.newConsecutiveMatchCount;
      result.missingCount = 0;
      result.message = `VLM Verified: Task completed with ${(inferenceResult.confidence * 100).toFixed(0)}% confidence`;
      result.shouldAdvanceStep = true;
      
      advanceStep();
    } else {
      result.newVlmFailureCount = currentVlmFailureCount + 1;
      result.newConsecutiveMatchCount = 0;
      
      result.verified = false;
      result.confidence = inferenceResult.confidence;
      result.mode = currentStep.verificationMode || 'presence';
      result.consecutiveMatches = 0;
      result.missingCount = result.newVlmFailureCount;
      result.message = `VLM Verification failed: ${inferenceResult.confidence < VLM_VERIFICATION_CONFIDENCE_THRESHOLD ? 'Low confidence' : 'Task not completed'}. Attempts: ${result.newVlmFailureCount}/${VLM_FAILED_VERIFICATION_THRESHOLD}`;

      if (result.newVlmFailureCount >= VLM_FAILED_VERIFICATION_THRESHOLD) {
        result.shouldTriggerCorrection = true;
        result.message += ' - Correction flow triggered';
      }
    }
  } catch (error) {
    result.message = 'VLM verification error';
  }

  return result;
}