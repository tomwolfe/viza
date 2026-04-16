'use client';

import { useRef, useCallback, useEffect, useReducer, useMemo } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG, logger } from '@/config';

export type InferenceStatus = 'idle' | 'capturing' | 'inferring' | 'error';

type InferenceState = {
  status: InferenceStatus;
  error: string | null;
};

type InferenceAction =
  | { type: 'START_CAPTURE' }
  | { type: 'START_INFERENCE' }
  | { type: 'COMPLETE' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

function inferenceReducer(state: InferenceState, action: InferenceAction): InferenceState {
  switch (action.type) {
    case 'START_CAPTURE':
      return { ...state, status: 'capturing', error: null };
    case 'START_INFERENCE':
      return { ...state, status: 'inferring', error: null };
    case 'COMPLETE':
      return { ...state, status: 'idle', error: null };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'RESET':
      return { ...state, status: 'idle', error: null };
    default:
      return state;
  }
}

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
  const statusRef = useRef<InferenceStatus>('idle');
  const currentAbortRef = useRef<AbortController | null>(null);
  const frameRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingQueueRef = useRef<{ prompt: string; voiceTriggered: boolean; resolver: (v: unknown) => void; rejecter: (e: unknown) => void } | null>(null);

  const [state, dispatch] = useReducer(inferenceReducer, { status: 'idle', error: null });
  const status = state.status;

  const abortCurrentInference = useCallback(() => {
    if (currentAbortRef.current) {
      currentAbortRef.current.abort();
    }
    currentAbortRef.current = new AbortController();
  }, []);

  const processInference = useCallback(
    async (prompt: string, voiceTriggered: boolean = false) => {
      if (!frameRef.current) return;

      const isQueued = pendingQueueRef.current !== null;
      if (isQueued && voiceTriggered) {
        const existing = pendingQueueRef.current;
        if (existing) {
          pendingQueueRef.current = { prompt, voiceTriggered, resolver: existing.resolver, rejecter: existing.rejecter };
        }
        logger.debug('[useInferenceLoop] Replacing queued request with latest');
        return;
      }
      if (isQueued && !voiceTriggered) {
        return;
      }

      statusRef.current = 'capturing';
      dispatch({ type: 'START_CAPTURE' });

      let frame: ImageBitmap | null = null;
      try {
        frame = await captureFrame(frameRef.current);
        if (!frame) {
          statusRef.current = 'idle';
          dispatch({ type: 'RESET' });
          return;
        }

        if (currentAbortRef.current?.signal.aborted) {
          frame.close();
          statusRef.current = 'idle';
          dispatch({ type: 'RESET' });
          return;
        }

        statusRef.current = 'inferring';
        dispatch({ type: 'START_INFERENCE' });

        const result = await runInference(frame, prompt);

        if (!currentAbortRef.current?.signal.aborted && result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }

        if (pendingQueueRef.current) {
          pendingQueueRef.current.resolver(result);
          pendingQueueRef.current = null;
        }
      } catch (error) {
        logger.error('[useInferenceLoop] Inference error:', error);
        if (frame) {
          try { frame.close(); } catch {}
        }
        if (pendingQueueRef.current) {
          pendingQueueRef.current.rejecter(error);
          pendingQueueRef.current = null;
        }
        statusRef.current = 'error';
        dispatch({ type: 'ERROR', error: (error as Error).message });
      } finally {
        if (frame) {
          try { frame.close(); } catch {}
        }
        
        const next = pendingQueueRef.current;
        if (next) {
          pendingQueueRef.current = null;
          statusRef.current = 'idle';
          dispatch({ type: 'COMPLETE' });
          processInference(next.prompt, next.voiceTriggered);
        } else {
          statusRef.current = 'idle';
          dispatch({ type: 'COMPLETE' });
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
      dispatch({ type: 'RESET' });
    } else if (!active && isActiveRef.current) {
      isActiveRef.current = false;
      cancelPending();
    }
  }, []);

  const cancelPending = useCallback(() => {
    abortCurrentInference();
    if (pendingQueueRef.current) {
      pendingQueueRef.current.rejecter(new Error('Cancelled'));
      pendingQueueRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, [abortCurrentInference]);

  const run = useCallback(
    async (prompt: string, voiceTriggered: boolean = false): Promise<unknown> => {
      if (!frameRef.current) {
        return null;
      }

      abortCurrentInference();
      if (pendingQueueRef.current) {
        pendingQueueRef.current.rejecter(new Error('Cancelled by new run trigger'));
        pendingQueueRef.current = null;
      }

      return new Promise((resolve, reject) => {
        pendingQueueRef.current = { prompt, voiceTriggered, resolver: resolve, rejecter: reject };
        processInference(prompt, voiceTriggered);
      });
    },
    [processInference, abortCurrentInference]
  );

  useEffect(() => {
    if (!isActiveRef.current) return undefined;

    intervalRef.current = setInterval(() => {
      if (pendingQueueRef.current === null) {
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