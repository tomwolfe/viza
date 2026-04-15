'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG, logger } from '@/config';

export type InferenceStatus = 'idle' | 'capturing' | 'inferring';

interface UseInferenceLoopOptions {
  runInference: (
    image: ImageBitmap,
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
  const frameRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProcessingRef = useRef(false);
  const pendingInferenceRef = useRef<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void; prompt: string; timestamp: number; voiceTriggered: boolean } | null>(null);
  const latestRequestRef = useRef<{ prompt: string; timestamp: number; voiceTriggered: boolean } | null>(null);

  const [status, setStatus] = useState<InferenceStatus>('idle');

  const abortCurrentInference = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
  }, []);

  const processInference = useCallback(
    async (prompt: string, shouldDropFrame: boolean = false) => {
      if (!frameRef.current) return;

      if (isProcessingRef.current) {
        if (shouldDropFrame && latestRequestRef.current) {
          latestRequestRef.current = { prompt, timestamp: Date.now(), voiceTriggered: shouldDropFrame };
          logger.debug('[useInferenceLoop] Dropping stale frame, queuing new request');
          return;
        }
        latestRequestRef.current = { prompt, timestamp: Date.now(), voiceTriggered: shouldDropFrame };
        return;
      }

      isProcessingRef.current = true;
      setStatus('capturing');

      let frame: ImageBitmap | null = null;
      try {
        frame = await captureFrame(frameRef.current);
        if (!frame) {
          setStatus('idle');
          isProcessingRef.current = false;
          return;
        }

        if (abortControllerRef.current?.signal.aborted) {
          setStatus('idle');
          isProcessingRef.current = false;
          return;
        }

        setStatus('inferring');

        const result = await runInference(frame, prompt);

        if (!abortControllerRef.current?.signal.aborted && result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }

        if (pendingInferenceRef.current) {
          pendingInferenceRef.current.resolve(result);
          pendingInferenceRef.current = null;
        }
      } catch (error) {
        logger.error('[useInferenceLoop] Inference error:', error);
        if (pendingInferenceRef.current) {
          pendingInferenceRef.current.reject(error);
          pendingInferenceRef.current = null;
        }
      } finally {
        if (frame) {
          try {
            frame.close();
          } catch {
            // Frame may already be closed
          }
        }
        setStatus('idle');
        isProcessingRef.current = false;

        if (latestRequestRef.current) {
          const { prompt, voiceTriggered } = latestRequestRef.current;
          latestRequestRef.current = null;
          processInference(prompt, voiceTriggered);
        }
      }
    },
    [runInference, captureFrame, onObjectsDetected]
  );

  const setVideoSource = useCallback((video: HTMLVideoElement | null) => {
    frameRef.current = video;
  }, []);

  const setActive = useCallback((active: boolean) => {
    if (active && !isActiveRef.current) {
      isActiveRef.current = true;
      setStatus('idle');
    } else if (!active && isActiveRef.current) {
      isActiveRef.current = false;
      cancelPending();
    }
  }, []);

  const cancelPending = useCallback(() => {
    abortCurrentInference();
    if (pendingInferenceRef.current) {
      pendingInferenceRef.current.reject(new Error('Cancelled'));
      pendingInferenceRef.current = null;
    }
    latestRequestRef.current = null;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus('idle');
  }, [abortCurrentInference]);

  const run = useCallback(
    async (prompt: string, voiceTriggered: boolean = false): Promise<unknown> => {
      if (!frameRef.current) {
        return null;
      }

      if (voiceTriggered) {
        abortCurrentInference();
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        pendingInferenceRef.current = null;
      }

      return new Promise((resolve, reject) => {
        pendingInferenceRef.current = { resolve, reject, prompt, timestamp: Date.now(), voiceTriggered };

        if (!isProcessingRef.current) {
          processInference(prompt, voiceTriggered);
        } else {
          latestRequestRef.current = { prompt, timestamp: Date.now(), voiceTriggered };
        }
      });
    },
    [abortCurrentInference, processInference]
  );

  useEffect(() => {
    if (!isActiveRef.current) return undefined;

    intervalRef.current = setInterval(() => {
      if (!isProcessingRef.current) {
        processInference('Identify objects in this scene.', false);
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      cancelPending();
    };
  }, [intervalMs, processInference, cancelPending]);

  return {
    status,
    setVideoSource,
    setActive,
    run,
    cancelPending,
  };
}