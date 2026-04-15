'use client';

import { useRef, useCallback, useEffect } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';

interface UseInferenceLoopOptions {
  runInference: (
    image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  captureFrame: (video: HTMLVideoElement | null) => Promise<ImageBitmap | null>;
  onObjectsDetected: (objects: DetectedObject[]) => void;
  intervalMs?: number;
}

export function useInferenceLoop({
  runInference,
  captureFrame,
  onObjectsDetected,
  intervalMs = CONFIG.INFERENCE_INTERVAL,
}: UseInferenceLoopOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);
  const frameRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  const setVideoSource = useCallback((video: HTMLVideoElement | null) => {
    frameRef.current = video;
  }, []);

  const setActive = useCallback((active: boolean) => {
    isActiveRef.current = active;
  }, []);

  const executeInference = useCallback(
    async (prompt: string, shouldAbort?: boolean) => {
      if (shouldAbort) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
      }

      if (!frameRef.current || isProcessingRef.current) return;

      isProcessingRef.current = true;

      try {
        const frame = await captureFrame(frameRef.current);
        if (!frame) return;

        if (abortControllerRef.current?.signal.aborted) {
          isProcessingRef.current = false;
          return;
        }

        const result = await runInference(frame, prompt);

        if (!abortControllerRef.current?.signal.aborted && result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }
      } catch (error) {
        console.error('[useInferenceLoop] Inference error:', error);
      } finally {
        isProcessingRef.current = false;
      }
    },
    [runInference, captureFrame, onObjectsDetected]
  );

  const cancelPending = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();
    }
    isProcessingRef.current = false;
  }, []);

  useEffect(() => {
    if (!isActiveRef.current) return undefined;

    let lastTime = 0;

    const tick = () => {
      if (!isActiveRef.current) return;

      const now = performance.now();

      if (!isProcessingRef.current && now - lastTime >= intervalMs) {
        lastTime = now;
        executeInference('Identify objects in this scene.');
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      cancelPending();
    };
  }, [intervalMs, executeInference, cancelPending]);

  return {
    setVideoSource,
    setActive,
    executeInference,
    cancelPending,
  };
}