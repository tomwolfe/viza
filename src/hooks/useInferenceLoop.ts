'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';

export type InferenceStatus = 'idle' | 'capturing' | 'inferring';

interface UseInferenceLoopOptions {
  runInference: (
    image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  captureFrame: (video: HTMLVideoElement | null) => Promise<ImageBitmap | null>;
  onObjectsDetected: (objects: DetectedObject[]) => void;
  intervalMs?: number;
}

type PendingInference = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  prompt: string;
  timestamp: number;
};

export function useInferenceLoop({
  runInference,
  captureFrame,
  onObjectsDetected,
  intervalMs = CONFIG.INFERENCE_INTERVAL,
}: UseInferenceLoopOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const frameRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const inferenceQueueRef = useRef<PendingInference[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<InferenceStatus>('idle');
  const isProcessingRef = useRef(false);

  const abortCurrentInference = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
  }, []);

  const processQueue = useCallback(
    async () => {
      if (!frameRef.current || isProcessingRef.current || inferenceQueueRef.current.length === 0) {
        return;
      }

      const nextInference = inferenceQueueRef.current.shift();
      if (!nextInference) return;

      isProcessingRef.current = true;
      setStatus('capturing');

      let frame: ImageBitmap | null = null;
      try {
        frame = await captureFrame(frameRef.current);
        if (!frame) {
          setStatus('idle');
          isProcessingRef.current = false;
          if (inferenceQueueRef.current.length > 0) {
            processQueue();
          }
          return;
        }

        if (abortControllerRef.current?.signal.aborted) {
          setStatus('idle');
          isProcessingRef.current = false;
          if (inferenceQueueRef.current.length > 0) {
            processQueue();
          }
          return;
        }

        setStatus('inferring');

        const result = await runInference(frame, nextInference.prompt);

        if (!abortControllerRef.current?.signal.aborted && result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }

        nextInference.resolve(result);
      } catch (error) {
        console.error('[useInferenceLoop] Inference error:', error);
        nextInference.reject(error);
      } finally {
        if (frame) {
          frame.close();
        }
        setStatus('idle');
        isProcessingRef.current = false;

        if (inferenceQueueRef.current.length > 0) {
          processQueue();
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
    inferenceQueueRef.current = [];
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStatus('idle');
  }, [abortCurrentInference]);

  const enqueueInference = useCallback(
    async (prompt: string, voiceTriggered: boolean = false): Promise<unknown> => {
      if (!frameRef.current) {
        return null;
      }

      if (voiceTriggered && isProcessingRef.current) {
        abortCurrentInference();
        inferenceQueueRef.current = [];
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }

      return new Promise((resolve, reject) => {
        inferenceQueueRef.current.push({
          resolve,
          reject,
          prompt,
          timestamp: Date.now(),
        });

        if (!isProcessingRef.current) {
          processQueue();
        }
      });
    },
    [abortCurrentInference, processQueue]
  );

  const executeInference = useCallback(
    async (prompt: string, shouldAbort?: boolean) => {
      if (isProcessingRef.current) return;

      if (shouldAbort) {
        abortCurrentInference();
      }

      if (!frameRef.current) return;

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
      } catch (error) {
        console.error('[useInferenceLoop] Inference error:', error);
      } finally {
        if (frame) {
          frame.close();
        }
        setStatus('idle');
        isProcessingRef.current = false;
      }
    },
    [runInference, captureFrame, onObjectsDetected, abortCurrentInference]
  );

  useEffect(() => {
    if (!isActiveRef.current) return undefined;

    intervalRef.current = setInterval(() => {
      if (!isProcessingRef.current) {
        executeInference('Identify objects in this scene.');
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      cancelPending();
    };
  }, [intervalMs, executeInference, cancelPending]);

  return {
    status,
    setVideoSource,
    setActive,
    executeInference,
    enqueueInference,
    cancelPending,
  };
}
