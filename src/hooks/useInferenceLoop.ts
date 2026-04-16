'use client';

import { useRef, useCallback, useEffect } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG, logger } from '@/config';

interface UseInferenceLoopOptions {
  runInference: (
    image: ImageBitmap,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  captureFrame: (video: HTMLVideoElement | null) => ImageBitmap | null;
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningRef = useRef(false);

  const processFrame = useCallback(
    async (prompt: string) => {
      if (isRunningRef.current || !videoRef.current) return;

      isRunningRef.current = true;
      performance.mark('inference-loop-start');

      let frame: ImageBitmap | null = null;
      try {
        frame = captureFrame(videoRef.current);
        if (!frame) {
          isRunningRef.current = false;
          return;
        }

        const result = await runInference(frame, prompt);

        if (result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }
      } catch (error) {
        logger.error('[useInferenceLoop] Inference error:', error);
      } finally {
        isRunningRef.current = false;
        performance.mark('inference-loop-complete');
        performance.measure('inference-cycle', 'inference-loop-start', 'inference-loop-complete');
      }
    },
    [runInference, captureFrame, onObjectsDetected]
  );

  const setVideoSource = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  const run = useCallback(
    async (prompt: string): Promise<unknown> => {
      if (!videoRef.current) {
        return null;
      }
      return processFrame(prompt);
    },
    [processFrame]
  );

  const cancelPending = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    isRunningRef.current = false;
  }, []);

  useEffect(() => {
    if (!isActive || isInferring) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!intervalRef.current) {
      intervalRef.current = setInterval(() => {
        if (!isRunningRef.current) {
          processFrame('Identify objects in this scene.');
        }
      }, intervalMs);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, isInferring, intervalMs, processFrame]);

  return {
    setVideoSource,
    run,
    cancelPending,
  };
}