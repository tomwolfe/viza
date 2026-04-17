'use client';

import { useRef, useCallback, useEffect } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG, logger } from '@/config';

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

interface PendingFrame {
  bitmap: ImageBitmap;
  timestamp: number;
  processed: boolean;
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
  const pendingFrameRef = useRef<PendingFrame | null>(null);
  const acknowledgedRef = useRef(true);

  const processFrame = useCallback(
    async (prompt: string) => {
      if (isRunningRef.current || !videoRef.current) return;
      if (!acknowledgedRef.current) {
        logger.debug('[useInferenceLoop] Waiting for previous frame acknowledgment');
        return;
      }

      isRunningRef.current = true;
      acknowledgedRef.current = false;

      if (CONFIG.ENABLE_TELEMETRY) {
        performance.mark('inference-loop-start');
      }

      let frame: ImageBitmap | null = null;
      try {
        const frameResult = captureFrame(videoRef.current);
        frame = frameResult instanceof Promise ? await frameResult : frameResult;
        if (!frame) {
          isRunningRef.current = false;
          acknowledgedRef.current = true;
          return;
        }

        pendingFrameRef.current = {
          bitmap: frame,
          timestamp: performance.now(),
          processed: false,
        };

        const result = await runInference(frame, prompt);

        if (result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }

        pendingFrameRef.current.processed = true;
      } catch (error) {
        logger.error('[useInferenceLoop] Inference error:', error);
        acknowledgedRef.current = true;
      } finally {
        if (frame) {
          try {
            frame.close();
          } catch {
            logger.debug('[useInferenceLoop] Frame already closed');
          }
        }
        isRunningRef.current = false;
        
        if (CONFIG.ENABLE_TELEMETRY) {
          performance.mark('inference-loop-complete');
          performance.measure('inference-cycle', 'inference-loop-start', 'inference-loop-complete');
        }
      }
    },
    [runInference, captureFrame, onObjectsDetected]
  );

  const acknowledgeFrame = useCallback(() => {
    acknowledgedRef.current = true;
    pendingFrameRef.current = null;
  }, []);

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
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    isRunningRef.current = false;
    acknowledgedRef.current = true;
    if (pendingFrameRef.current && !pendingFrameRef.current.processed) {
      try {
        pendingFrameRef.current.bitmap.close();
      } catch {}
      pendingFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isActive || isInferring) {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;

    const loop = async () => {
      if (!isRunningRef.current) {
        await processFrame('Identify objects in this scene.');
      }
      timeoutId = setTimeout(loop, intervalMs);
    };

    timeoutId = setTimeout(loop, intervalMs);
    intervalRef.current = timeoutId;

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
      isRunningRef.current = false;
    };
  }, [isActive, isInferring, intervalMs, processFrame]);

  return {
    setVideoSource,
    run,
    cancelPending,
    acknowledgeFrame,
    hasPendingFrame: () => !acknowledgedRef.current,
  };
}