'use client';

import { useRef, useCallback, useEffect } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG, logger } from '@/config';
import { useInferenceAnalytics } from './useInferenceAnalytics';
import { ensureBitmapClosed, isBitmapValid } from '@/utils/SafeTransfer';

interface UseInferenceLoopOptions {
  runInference: (
    image: ImageBitmap,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  captureFrame: (video: HTMLVideoElement | null) => Promise<ImageBitmap | null> | ImageBitmap | null;
  onObjectsDetected: (objects: DetectedObject[]) => void;
  isInferring: boolean;
  intervalMs?: number;
  isActive?: boolean;
  getStallStatus?: () => { isStalled: boolean; timeOnStep: number; shouldSuggestHint: boolean };
  triggerHint?: (worldMapObjects: { name: string }[]) => void;
  worldMapObjects?: { name: string }[];
  getVlmVerificationFailureCount?: () => number;
  runVerificationInference?: (image: ImageBitmap, validationPrompt: string, targetObject: string) => Promise<{ isCompleted: boolean; confidence: number } | null>;
  triggerCorrectionFlow?: (analysis: string, image: ImageBitmap) => Promise<boolean>;
  isTaskActive?: boolean;
}

export function useInferenceLoop({
  runInference,
  captureFrame,
  onObjectsDetected,
  isInferring,
  intervalMs = CONFIG.INFERENCE_INTERVAL,
  isActive = false,
  getStallStatus,
  triggerHint,
  worldMapObjects = [],
  getVlmVerificationFailureCount,
  runVerificationInference,
  triggerCorrectionFlow,
  isTaskActive = false,
}: UseInferenceLoopOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRunningRef = useRef(false);
  const acknowledgedRef = useRef(true);

   const {
    adjustedInterval,
    recordMetrics,
  } = useInferenceAnalytics({ intervalMs });

  const processFrame = useCallback(
    async (prompt: string) => {
      if (isRunningRef.current || !videoRef.current || !acknowledgedRef.current) {
        isRunningRef.current = false;
        acknowledgedRef.current = true;
        return;
      }

      const loopStartTime = performance.now();
      isRunningRef.current = true;
      acknowledgedRef.current = false;

      let frame: ImageBitmap | null = null;
      
      try {
        const captureStartTime = performance.now();
        const captureResult = callbacksRef.current.captureFrame(videoRef.current);
        frame = captureResult instanceof Promise ? await captureResult : captureResult;
        
        if (!frame) {
          isRunningRef.current = false;
          acknowledgedRef.current = true;
          return;
        }
        
        try {
          const inferenceStartTime = performance.now();
          const result = await callbacksRef.current.runInference(frame, prompt);

          const inferenceEndTime = performance.now();
          const processingTime = inferenceEndTime - loopStartTime;

          if (result?.objects && result.objects.length > 0) {
            callbacksRef.current.onObjectsDetected?.(result.objects);
          }

          recordMetrics({
            captureTime: inferenceStartTime - captureStartTime,
            inferenceTime: inferenceEndTime - inferenceStartTime,
            processingTime,
          });
        } catch (error) {
          logger.error('[useInferenceLoop] Inference error:', error);
        }
      } finally {
        if (isBitmapValid(frame)) {
          ensureBitmapClosed(frame);
        }
        isRunningRef.current = false;
        acknowledgedRef.current = true;
      }
    },
   [recordMetrics]
  );

  const callbacksRef = useRef({ captureFrame, runInference, processFrame, onObjectsDetected, getStallStatus, getVlmVerificationFailureCount, isTaskActive, runVerificationInference, triggerCorrectionFlow, triggerHint, worldMapObjects });

  useEffect(() => {
    callbacksRef.current = { captureFrame, runInference, processFrame, onObjectsDetected, getStallStatus, getVlmVerificationFailureCount, isTaskActive, runVerificationInference, triggerCorrectionFlow, triggerHint, worldMapObjects };
  }, [captureFrame, runInference, processFrame, onObjectsDetected, getStallStatus, getVlmVerificationFailureCount, isTaskActive, runVerificationInference, triggerCorrectionFlow, triggerHint, worldMapObjects]);

  const setVideoSource = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  const cancelPending = useCallback(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    isRunningRef.current = false;
    acknowledgedRef.current = true;
  }, []);

  const stateRef = useRef({ isActive, isInferring, adjustedInterval });
  useEffect(() => {
    stateRef.current = { isActive, isInferring, adjustedInterval };
  }, [isActive, isInferring, adjustedInterval]);

  useEffect(() => {
    if (!isActive) {
      cancelPending();
      return;
    }

    let isMounted = true;

     const loop = async () => {
      if (!isMounted || !stateRef.current.isActive) return;

      const { captureFrame: captureFrameRef, processFrame: processFrameRef, getStallStatus: getStallStatusRef, getVlmVerificationFailureCount: getVlmVerificationFailureCountRef, isTaskActive: isTaskActiveRef, runVerificationInference: runVerificationInferenceRef, triggerCorrectionFlow: triggerCorrectionFlowRef, triggerHint: triggerHintRef, worldMapObjects: worldMapObjectsRef } = callbacksRef.current;

      if (!isRunningRef.current && acknowledgedRef.current) {
        if (getStallStatusRef && triggerHintRef) {
          const stallStatus = getStallStatusRef();
          if (stallStatus.shouldSuggestHint) {
            triggerHintRef(worldMapObjectsRef);
          }
        }

        if (isTaskActiveRef && getVlmVerificationFailureCountRef && runVerificationInferenceRef && triggerCorrectionFlowRef) {
          const failureCount = getVlmVerificationFailureCountRef();
          
          if (failureCount >= 3) {
            logger.debug('[InferenceLoop] VLM verification failed 3+ times, triggering correction flow');
            cancelPending();
            
            if (videoRef.current) {
              const frameResult = captureFrameRef(videoRef.current);
              const imageBitmap = frameResult instanceof Promise ? await frameResult : frameResult;
              
              if (imageBitmap) {
                const analysis = 'The user is failing to complete this step after multiple attempts. Analyze the image and provide a new, intermediate correction step to help them.';
                const success = await triggerCorrectionFlowRef(analysis, imageBitmap);
                if (!success && isBitmapValid(imageBitmap)) {
                  ensureBitmapClosed(imageBitmap);
                }
              }
            }
          }
        }

        await processFrameRef('Identify objects in this scene.');
      }
      if (isMounted) {
        intervalRef.current = setTimeout(loop, stateRef.current.adjustedInterval);
      }
    };

    loop();

    return () => {
      isMounted = false;
      cancelPending();
    };
  }, [
    isActive,
    cancelPending,
    stateRef,
  ]);

  const run = useCallback(
    async (prompt: string): Promise<void> => {
      await processFrame(prompt);
    },
    [processFrame]
  );

  return {
    setVideoSource,
    run,
    cancelPending,
    acknowledgeFrame: () => { acknowledgedRef.current = true; },
    hasPendingFrame: () => !acknowledgedRef.current,
  };
}
