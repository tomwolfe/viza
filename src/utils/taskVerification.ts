import type { DetectedObject } from '@/schemas/vision';
import type { TaskStep } from '../hooks/useTaskState';
import { logger } from '@/config';

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

export const DEFAULT_CONSECUTIVE_DETECTIONS = 3;
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
export const DETECTION_HISTORY_SIZE = 10;
export const VERIFICATION_COOLDOWN_MS = 2000;
export const VLM_VERIFICATION_CONFIDENCE_THRESHOLD = 0.75;
export const VLM_FAILED_VERIFICATION_THRESHOLD = 3;

export class VerificationEngine {
  private detectionHistory: DetectionRecord[] = [];
  private consecutiveMatchCount: number = 0;
  private lastVerificationTime: number = 0;
  private vlmFailureCount: number = 0;

  constructor() {}

  reset() {
    this.detectionHistory = [];
    this.consecutiveMatchCount = 0;
    this.lastVerificationTime = 0;
    this.vlmFailureCount = 0;
  }

  getStats() {
    return {
      consecutiveMatchCount: this.consecutiveMatchCount,
      vlmFailureCount: this.vlmFailureCount,
    };
  }

  setConsecutiveMatchCount(count: number) {
    this.consecutiveMatchCount = count;
  }

  resetVlmFailureCount() {
    this.vlmFailureCount = 0;
  }

  /**
   * 2D Heuristic-based verification (fast, per-frame)
   */
  checkHeuristic(
    detectedObjects: DetectedObject[],
    taskState: TaskStateContext,
    worldMapPositions?: Map<string, { x: number; y: number; z: number }>
  ): VerificationResult & { shouldAdvanceStep: boolean } {
    const result = {
      verified: false,
      confidence: 0,
      mode: 'none' as const,
      consecutiveMatches: this.consecutiveMatchCount,
      missingCount: 0,
      message: '',
      shouldAdvanceStep: false,
    };

    if (!taskState.isActive) return result;

    const currentStep = taskState.steps[taskState.currentStepIndex];
    if (!currentStep) return result;

    const targetObject = currentStep.targetObject;
    const verificationMode = currentStep.verificationMode || 'presence';
    const requiredDetections = currentStep.requiredConsecutiveDetections || DEFAULT_CONSECUTIVE_DETECTIONS;
    const confidenceThreshold = currentStep.confidenceThreshold || DEFAULT_CONFIDENCE_THRESHOLD;

    result.mode = verificationMode;

    if (!targetObject) {
      result.verified = true;
      result.message = 'No target object specified';
      return { ...result, shouldAdvanceStep: true };
    }

    const targetLower = targetObject.toLowerCase();
    const foundTarget = detectedObjects.find(obj =>
      obj.name.toLowerCase().includes(targetLower)
    );

    const now = performance.now();
    const timeSinceLastCheck = now - this.lastVerificationTime;

    if (timeSinceLastCheck < VERIFICATION_COOLDOWN_MS && this.consecutiveMatchCount > 0) {
      return result;
    }

    this.lastVerificationTime = now;

    if (verificationMode === 'removal') {
      const worldMapPosition = worldMapPositions?.get(targetLower);
      const wasPreviouslyPresent = worldMapPosition !== undefined;

      if (!foundTarget && wasPreviouslyPresent) {
        const absentCount = this.detectionHistory.filter(r => !r.wasPresent && r.objectName === targetLower).length;

        this.recordDetection(targetLower, false);

        if (absentCount >= requiredDetections - 1) {
          result.verified = true;
          result.confidence = 1.0;
          result.message = `Verified: ${targetObject} has been removed`;
          this.consecutiveMatchCount = 0;
          result.shouldAdvanceStep = true;
        } else {
          result.missingCount = absentCount + 1;
          result.message = `Verifying removal: ${targetObject} not seen for ${absentCount + 1} checks`;
        }
      } else if (foundTarget) {
        result.confidence = foundTarget.confidence || 0.5;
        result.message = `${targetObject} still visible - waiting for removal`;
        this.consecutiveMatchCount = 0;
      }
    } else {
      // presence or placement
      if (foundTarget) {
        const conf = foundTarget.confidence || 0.5;
        if (conf >= confidenceThreshold) {
          this.consecutiveMatchCount += 1;
          this.recordDetection(targetLower, true);

          result.confidence = conf;
          result.consecutiveMatches = this.consecutiveMatchCount;

          if (this.consecutiveMatchCount >= requiredDetections) {
            result.verified = true;
            result.message = `Verified: ${targetObject} found`;
            result.shouldAdvanceStep = true;
          } else {
            result.message = `Verifying: ${this.consecutiveMatchCount}/${requiredDetections} confirmations`;
          }
        } else {
          result.confidence = conf;
          result.message = `Low confidence (${(conf * 100).toFixed(0)}%)`;
          this.consecutiveMatchCount = 0;
        }
      } else {
        this.consecutiveMatchCount = 0;
        result.message = `${targetObject} not detected`;
      }
    }

    return result;
  }

  /**
   * VLM-based verification (slow, high-accuracy)
   */
  async verifyVLM(
    image: ImageBitmap,
    taskState: TaskStateContext,
    runInference: (image: ImageBitmap, prompt: string, target: string) => Promise<{ isCompleted: boolean; confidence: number } | null>
  ): Promise<VerificationResult & { shouldAdvanceStep: boolean; shouldTriggerCorrection: boolean }> {
    const result = {
      verified: false,
      confidence: 0,
      mode: 'none' as const,
      consecutiveMatches: this.consecutiveMatchCount,
      missingCount: this.vlmFailureCount,
      message: '',
      shouldAdvanceStep: false,
      shouldTriggerCorrection: false,
    };

    if (!taskState.isActive) return result;

    const currentStep = taskState.steps[taskState.currentStepIndex];
    if (!currentStep) return result;

    result.mode = currentStep.verificationMode || 'presence';

    try {
      const inferenceResult = await runInference(
        image,
        currentStep.validationPrompt,
        currentStep.targetObject || ''
      );

      if (!inferenceResult) {
        result.message = 'VLM verification inference failed';
        return result;
      }

      if (inferenceResult.isCompleted && inferenceResult.confidence >= VLM_VERIFICATION_CONFIDENCE_THRESHOLD) {
        this.vlmFailureCount = 0;
        this.consecutiveMatchCount += 1;
        
        result.verified = true;
        result.confidence = inferenceResult.confidence;
        result.consecutiveMatches = this.consecutiveMatchCount;
        result.message = `VLM Verified: Task completed (${(inferenceResult.confidence * 100).toFixed(0)}%)`;
        result.shouldAdvanceStep = true;
      } else {
        this.vlmFailureCount += 1;
        this.consecutiveMatchCount = 0;
        
        result.confidence = inferenceResult.confidence;
        result.missingCount = this.vlmFailureCount;
        result.message = `VLM failed: ${inferenceResult.confidence < VLM_VERIFICATION_CONFIDENCE_THRESHOLD ? 'Low confidence' : 'Not completed'}. Attempts: ${this.vlmFailureCount}/${VLM_FAILED_VERIFICATION_THRESHOLD}`;

        if (this.vlmFailureCount >= VLM_FAILED_VERIFICATION_THRESHOLD) {
          result.shouldTriggerCorrection = true;
        }
      }
    } catch (error) {
      logger.error('[VerificationEngine] VLM error:', error);
      result.message = 'VLM verification error';
    }

    return result;
  }

  private recordDetection(objectName: string, wasPresent: boolean) {
    this.detectionHistory.push({
      objectName,
      wasPresent,
      timestamp: performance.now(),
    });
    if (this.detectionHistory.length > DETECTION_HISTORY_SIZE) {
      this.detectionHistory.shift();
    }
  }
}

// Legacy exports for compatibility during transition
export function checkTargetFound(params: any): any {
  // This is a placeholder to prevent immediate breakages
  return {};
}
