'use client';

import { useCallback } from 'react';
import { useUserMedia } from './useUserMedia';
import { useInferenceLoop } from './useInferenceLoop';
import { useFrameCapture } from './useFrameCapture';
import { CONFIG } from '@/config';
import type { DetectedObject } from '@/schemas/vision';

export interface UseSceneInferenceOptions {
  isARActive: boolean;
  isModelReady: boolean;
  runInference: (
    image: ImageBitmap,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  setDetectedObjects: (objects: DetectedObject[]) => void;
  checkTargetFound?: (objects: DetectedObject[]) => void;
  speak?: (text: string) => void;
  isXRMode?: boolean;
  sceneImageRef?: React.MutableRefObject<ImageBitmap | null>;
  isInferring?: boolean;
}

export interface UseSceneInferenceReturn {
  videoElement: HTMLVideoElement | null;
  setVideoSource: (video: HTMLVideoElement | null) => void;
  run: (prompt: string) => Promise<void>;
  cancelPending: () => void;
}

export function useSceneInference({
  isARActive,
  isModelReady,
  runInference,
  setDetectedObjects,
  checkTargetFound,
  speak,
  isXRMode = false,
  sceneImageRef,
  isInferring = false,
}: UseSceneInferenceOptions): UseSceneInferenceReturn {
  const { videoElement } = useUserMedia({ isActive: isARActive && !isXRMode });
  const { captureFrame } = useFrameCapture();

  const handleCaptureFrame = useCallback(
    async (video: HTMLVideoElement | null) => {
      const frame = await captureFrame(video);
      if (!frame) return null;

      if (sceneImageRef) {
        const oldBitmap = sceneImageRef.current;
        sceneImageRef.current = await createImageBitmap(frame);
        if (oldBitmap) {
          oldBitmap.close();
        }
      }
      return frame;
    },
    [captureFrame, sceneImageRef]
  );

  const actionStringsFn = useCallback((objects: DetectedObject[]): string => {
    return objects
      .filter((obj) => obj.action)
      .map((obj) => `${obj.name}: ${obj.action}`)
      .join('. ');
  }, []);

  const handleObjectsDetected = useCallback(
    (objects: DetectedObject[]) => {
      setDetectedObjects(objects);

      if (checkTargetFound) {
        checkTargetFound(objects);
      }

      const actions = actionStringsFn(objects);

      if (actions && speak) {
        speak(actions);
      }
    },
    [setDetectedObjects, checkTargetFound, actionStringsFn, speak]
  );

  const { setVideoSource, run, cancelPending } = useInferenceLoop({
    runInference,
    captureFrame: handleCaptureFrame,
    onObjectsDetected: handleObjectsDetected,
    isInferring,
    intervalMs: CONFIG.INFERENCE_INTERVAL,
    isActive: isARActive && isModelReady,
  });

  return {
    videoElement,
    setVideoSource,
    run,
    cancelPending,
  };
}

export function actionStrings(objects: DetectedObject[]): string {
  return objects
    .filter((obj) => obj.action)
    .map((obj) => `${obj.name}: ${obj.action}`)
    .join('. ');
}