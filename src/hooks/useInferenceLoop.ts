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
  transferred: boolean;
}

interface TelemetryData {
  captureTime: number;
  inferenceTime: number;
  processingTime: number;
  skipCount: number;
}

interface InferenceBuffer {
  samples: number[];
  avgInferenceTime: number;
  adjustedInterval: number;
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
  
  const lastInferenceDurationRef = useRef(0);
  const skipCountRef = useRef(0);
  const telemetryFrameCountRef = useRef(0);
  const lastTelemetryRef = useRef<TelemetryData>({ captureTime: 0, inferenceTime: 0, processingTime: 0, skipCount: 0 });

  const inferenceBufferRef = useRef<InferenceBuffer>({
    samples: [],
    avgInferenceTime: 0,
    adjustedInterval: intervalMs,
  });

  const MAX_BUFFER_SIZE = 5;
  const ADJUSTMENT_THRESHOLD = 0.7;
  const ADJUSTMENT_STEP_MS = 1000;
  const MIN_INTERVAL = 500;
  const MAX_INTERVAL = 10000;

  const shouldSkipFrame = useCallback(() => {
    if (lastInferenceDurationRef.current > intervalMs) {
      skipCountRef.current += 1;
      return true;
    }
    return false;
  }, [intervalMs, lastInferenceDurationRef]);

  const processFrame = useCallback(
    async (prompt: string) => {
      if (isRunningRef.current || !videoRef.current) return;
      if (!acknowledgedRef.current) {
        logger.debug('[useInferenceLoop] Waiting for previous frame acknowledgment');
        return;
      }

      if (shouldSkipFrame()) {
        logger.debug('[useInferenceLoop] Skipping frame due to inference time');
        isRunningRef.current = false;
        acknowledgedRef.current = true;
        return;
      }

      const loopStartTime = performance.now();
      isRunningRef.current = true;
      acknowledgedRef.current = false;

      if (CONFIG.ENABLE_TELEMETRY) {
        performance.mark('inference-loop-start');
      }

      let frame: ImageBitmap | null = null;
      let captureStartTime = 0;
      let inferenceStartTime = 0;
      
      try {
        captureStartTime = performance.now();
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
          transferred: false,
        };

        inferenceStartTime = performance.now();
        const result = await runInference(frame, prompt);

        if (result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }

        pendingFrameRef.current.processed = true;
        pendingFrameRef.current.transferred = true;
        
        lastInferenceDurationRef.current = performance.now() - loopStartTime;
        
        if (CONFIG.ENABLE_TELEMETRY) {
          const captureTime = inferenceStartTime - captureStartTime;
          const inferenceTime = performance.now() - inferenceStartTime;
          const processingTime = performance.now() - loopStartTime;
          
          telemetryFrameCountRef.current += 1;
          
          if (telemetryFrameCountRef.current % 10 === 0) {
            lastTelemetryRef.current = {
              captureTime,
              inferenceTime,
              processingTime,
              skipCount: skipCountRef.current,
            };
            logger.debug('[Telemetry]', {
              captureTime: `${captureTime.toFixed(1)}ms`,
              inferenceTime: `${inferenceTime.toFixed(1)}ms`,
              processingTime: `${processingTime.toFixed(1)}ms`,
              skipCount: skipCountRef.current,
            });
          }
        }

        const inferenceDuration = performance.now() - loopStartTime;
        inferenceBufferRef.current.samples.push(inferenceDuration);

        if (inferenceBufferRef.current.samples.length > MAX_BUFFER_SIZE) {
          inferenceBufferRef.current.samples.shift();
        }

        if (inferenceBufferRef.current.samples.length >= MAX_BUFFER_SIZE) {
          const sum = inferenceBufferRef.current.samples.reduce((a, b) => a + b, 0);
          const avgInferenceTime = sum / inferenceBufferRef.current.samples.length;
          inferenceBufferRef.current.avgInferenceTime = avgInferenceTime;

          if (avgInferenceTime > intervalMs * ADJUSTMENT_THRESHOLD) {
            const newInterval = Math.min(MAX_INTERVAL, inferenceBufferRef.current.adjustedInterval + ADJUSTMENT_STEP_MS);
            inferenceBufferRef.current.adjustedInterval = newInterval;
            logger.debug('[useInferenceLoop] Adjusting interval to', newInterval, 'ms due to high inference time');
          }
        }
      } catch (error) {
        logger.error('[useInferenceLoop] Inference error:', error);
        acknowledgedRef.current = true;
      } finally {
        const bitmap = frame ?? pendingFrameRef.current?.bitmap;
        if (bitmap && !pendingFrameRef.current?.transferred) {
          try {
            bitmap.close();
          } catch {
            logger.debug('[useInferenceLoop] Frame already closed');
          }
        }
        pendingFrameRef.current = null;
        isRunningRef.current = false;
        
        if (CONFIG.ENABLE_TELEMETRY) {
          performance.mark('inference-loop-complete');
          performance.measure('inference-cycle', 'inference-loop-start', 'inference-loop-complete');
        }
      }
    },
    [runInference, captureFrame, onObjectsDetected, shouldSkipFrame, intervalMs]
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
    if (pendingFrameRef.current && !pendingFrameRef.current.transferred) {
      try {
        pendingFrameRef.current.bitmap.close();
      } catch {}
    }
    pendingFrameRef.current = null;
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
      const effectiveInterval = inferenceBufferRef.current.adjustedInterval > 0
        ? inferenceBufferRef.current.adjustedInterval
        : intervalMs;
      timeoutId = setTimeout(loop, effectiveInterval);
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