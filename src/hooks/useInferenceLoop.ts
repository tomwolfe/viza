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
  const abortControllerRef = useRef<AbortController | null>(null);
  const frameRef = useRef<HTMLVideoElement | null>(null);
  const isActiveRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProcessingRef = useRef(false);
  const pendingInferenceRef = useRef<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void; prompt: string; timestamp: number; voiceTriggered: boolean } | null>(null);
  const latestRequestRef = useRef<{ prompt: string; timestamp: number; voiceTriggered: boolean } | null>(null);

  const [state, dispatch] = useReducer(inferenceReducer, { status: 'idle', error: null });
  const status = state.status;

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
          // If not dropping, and processing is active, we just queue/update the reference for the current run
          if (latestRequestRef.current) {
            latestRequestRef.current = { prompt, timestamp: Date.now(), voiceTriggered: shouldDropFrame };
          }
          return;
        }

        isProcessingRef.current = true;
        dispatch({ type: 'START_CAPTURE' });

        let frame: ImageBitmap | null = null;
        try {
          frame = await captureFrame(frameRef.current);
          if (!frame) {
            dispatch({ type: 'RESET' });
            isProcessingRef.current = false;
            return;
          }

          if (abortControllerRef.current?.signal.aborted) {
            dispatch({ type: 'RESET' });
            isProcessingRef.current = false;
            return;
          }

          dispatch({ type: 'START_INFERENCE' });

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
          dispatch({ type: 'ERROR', error: (error as Error).message });
          if (pendingInferenceRef.current) {
            pendingInferenceRef.current.reject(error);
            pendingInferenceRef.current = null;
          }
        } finally {
          dispatch({ type: 'COMPLETE' });
          isProcessingRef.current = false;

          // After completion, check if there is a new request queued (either from another processInference call or from the run() function)
          if (latestRequestRef.current) {
            const { prompt, voiceTriggered } = latestRequestRef.current;
            latestRequestRef.current = null;
            // Recursively call processInference to handle the queued request
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
      dispatch({ type: 'RESET' });
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
    dispatch({ type: 'RESET' });
  }, [abortCurrentInference]);

 const run = useCallback(
     async (prompt: string, voiceTriggered: boolean = false): Promise<unknown> => {
       if (!frameRef.current) {
         return null;
       }

       abortCurrentInference();
       latestRequestRef.current = null;
       if (pendingInferenceRef.current) {
         pendingInferenceRef.current.reject(new Error('Cancelled by new run trigger'));
         pendingInferenceRef.current = null;
       }

       return new Promise((resolve, reject) => {
         latestRequestRef.current = { prompt, timestamp: Date.now(), voiceTriggered };
         pendingInferenceRef.current = { resolve, reject, prompt, timestamp: Date.now(), voiceTriggered };
         processInference(prompt, voiceTriggered);
       });
     },
     [processInference, abortCurrentInference]
   );

  useEffect(() => {
    if (!isActiveRef.current) return undefined;

    intervalRef.current = setInterval(() => {
      if (!isProcessingRef.current) {
        const hasPendingVoiceRequest = latestRequestRef.current?.voiceTriggered;
        if (!hasPendingVoiceRequest) {
          processInference('Identify objects in this scene.', false);
        }
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