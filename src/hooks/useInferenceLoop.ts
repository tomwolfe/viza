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
  isActive?: boolean;
}

export function useInferenceLoop({
  runInference,
  captureFrame,
  onObjectsDetected,
  intervalMs = CONFIG.INFERENCE_INTERVAL,
  isActive = false,
}: UseInferenceLoopOptions) {
  const statusRef = useRef<InferenceStatus>('idle');
  const abortControllerRef = useRef<AbortController | null>(null);
  const frameRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(isActive);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentRunResolverRef = useRef<((v: unknown) => void) | null>(null);
  const currentRunRejecterRef = useRef<((e: unknown) => void) | null>(null);

  const [state, dispatch] = useReducer(inferenceReducer, { status: 'idle', error: null });
  const status = state.status;

  const abortCurrent = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
  }, []);

  const processInference = useCallback(
    async (prompt: string, isVoiceCommand: boolean = false) => {
      if (!frameRef.current) return;

      if (isVoiceCommand && abortControllerRef.current) {
        abortCurrent();
      }

      statusRef.current = 'capturing';
      dispatch({ type: 'START_CAPTURE' });

      performance.mark('inference-loop-start');

      let frame: ImageBitmap | null = null;
      try {
        frame = await captureFrame(frameRef.current);
        if (!frame) {
          statusRef.current = 'idle';
          dispatch({ type: 'RESET' });
          return;
        }

        if (abortControllerRef.current?.signal.aborted) {
          statusRef.current = 'idle';
          dispatch({ type: 'RESET' });
          return;
        }

        statusRef.current = 'inferring';
        dispatch({ type: 'START_INFERENCE' });

        const result = await runInference(frame, prompt);

        if (!abortControllerRef.current?.signal.aborted && result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }

        if (currentRunResolverRef.current) {
          currentRunResolverRef.current(result);
          currentRunResolverRef.current = null;
          currentRunRejecterRef.current = null;
        }
      } catch (error) {
        logger.error('[useInferenceLoop] Inference error:', error);
        if (frame) {
          try { frame.close(); } catch {}
        }
        if (currentRunRejecterRef.current) {
          currentRunRejecterRef.current(error);
          currentRunResolverRef.current = null;
          currentRunRejecterRef.current = null;
        }
        statusRef.current = 'error';
        dispatch({ type: 'ERROR', error: (error as Error).message });
      } finally {
        if (frame) {
          try { frame.close(); } catch {}
        }

        statusRef.current = 'idle';
        dispatch({ type: 'COMPLETE' });

        performance.mark('inference-loop-complete');
        performance.measure('inference-cycle', 'inference-loop-start', 'inference-loop-complete');
      }
    },
    [runInference, captureFrame, onObjectsDetected, abortCurrent]
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
    abortCurrent();
    if (currentRunRejecterRef.current) {
      currentRunRejecterRef.current(new Error('Cancelled'));
      currentRunResolverRef.current = null;
      currentRunRejecterRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, [abortCurrent]);

  const run = useCallback(
    async (prompt: string, isVoiceCommand: boolean = false): Promise<unknown> => {
      if (!frameRef.current) {
        return null;
      }

      abortCurrent();

      return new Promise((resolve, reject) => {
        currentRunResolverRef.current = resolve;
        currentRunRejecterRef.current = reject;
        processInference(prompt, isVoiceCommand);
      });
    },
    [processInference, abortCurrent]
  );

  useEffect(() => {
    if (!isActiveRef.current) return undefined;

    intervalRef.current = setInterval(() => {
      if (statusRef.current === 'idle') {
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

  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive && !intervalRef.current) {
      intervalRef.current = setInterval(() => {
        if (statusRef.current === 'idle') {
          processInference('Identify objects in this scene.', false);
        }
      }, intervalMs);
    } else if (!isActive && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [isActive, intervalMs, processInference]);

  return {
    status,
    setVideoSource,
    setActive,
    run,
    cancelPending,
  };
}