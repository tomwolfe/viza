'use client';

import { useRef, useCallback, useEffect } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG, logger } from '@/config';
import { useInferenceAnalytics } from './useInferenceAnalytics';

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
}

export function useInferenceLoop({
  runInference,
  captureFrame,
  onObjectsDetected,
  isInferring,
  intervalMs = CONFIG.INFERENCE_INTERVAL,
  isActive = false,
}: UseInferenceLoopOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRunningRef = useRef(false);
  const acknowledgedRef = useRef(true);

  const {
    adjustedInterval,
    recordMetrics,
    recordSkip,
  } = useInferenceAnalytics({ intervalMs });

  const processFrame = useCallback(
    async (prompt: string) => {
      if (isRunningRef.current || !videoRef.current || !acknowledgedRef.current) return;

      const loopStartTime = performance.now();
      isRunningRef.current = true;
      acknowledgedRef.current = false;

      let frame: ImageBitmap | null = null;
      
      try {
        const captureStartTime = performance.now();
        const captureResult = captureFrame(videoRef.current);
        frame = captureResult instanceof Promise ? await captureResult : captureResult;
        
        if (!frame) {
          isRunningRef.current = false;
          acknowledgedRef.current = true;
          return;
        }

        let transferred = false;
        
        try {
          const inferenceStartTime = performance.now();
          const result = await runInference(frame, prompt);
          transferred = true;

          const inferenceEndTime = performance.now();
          const processingTime = inferenceEndTime - loopStartTime;

          if (result?.objects && result.objects.length > 0) {
            onObjectsDetected(result.objects);
          }

          recordMetrics({
            captureTime: inferenceStartTime - captureStartTime,
            inferenceTime: inferenceEndTime - inferenceStartTime,
            processingTime,
          });
        } catch (error) {
          logger.error('[useInferenceLoop] Inference error:', error);
          transferred = true;
        }
      } finally {
        if (frame && !transferred) {
          frame.close();
        }
        isRunningRef.current = false;
        acknowledgedRef.current = true;
      }
    },
    [runInference, captureFrame, onObjectsDetected, recordMetrics]
  );

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

  useEffect(() => {
    if (!isActive || isInferring) {
      cancelPending();
      return;
    }

    const loop = async () => {
      if (!isRunningRef.current && acknowledgedRef.current) {
        await processFrame('Identify objects in this scene.');
      }
      intervalRef.current = setTimeout(loop, adjustedInterval);
    };

    intervalRef.current = setTimeout(loop, intervalMs);

    return () => cancelPending();
  }, [isActive, isInferring, intervalMs, adjustedInterval, processFrame, cancelPending]);

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
