'use client';

import { useRef, useCallback, useEffect } from 'react';
import { WorldMapRenderer } from './WorldMapRenderer';
import { useInferenceLoop } from '@/hooks/useInferenceLoop';
import { useFrameCapture } from '@/hooks/useFrameCapture';
import { useUserMedia } from '@/hooks/useUserMedia';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useSpatial } from '@/contexts/SpatialContext';
import { useTaskContext } from '@/contexts/TaskContext';
import type { DetectedObject } from '@/schemas/vision';
import type { WorldObject } from '@/hooks/useWorldMap';
import { CONFIG } from '@/config';
import * as THREE from 'three';

function actionStrings(objects: DetectedObject[]): string {
  return objects
    .filter(obj => obj.action)
    .map(obj => `${obj.name}: ${obj.action}`)
    .join('. ');
}

interface ARSceneProps {
  isARActive: boolean;
  isModelReady: boolean;
  runInference?: (
    image: ImageBitmap,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  detectedObjects?: DetectedObject[];
  worldObjects?: WorldObject[];
  onObjectsDetected?: (objects: DetectedObject[]) => void;
  taskActive?: boolean;
  currentStepTarget?: string;
  checkTargetFound?: (objects: DetectedObject[]) => void;
  speak?: (text: string) => void;
  isXRMode?: boolean;
  sceneImageRef?: React.MutableRefObject<ImageBitmap | null>;
}

export function ARScene({
  isARActive,
  isModelReady,
  runInference,
  detectedObjects,
  worldObjects,
  onObjectsDetected,
  taskActive,
  currentStepTarget,
  checkTargetFound,
  speak,
  isXRMode = false,
  sceneImageRef,
}: ARSceneProps) {
  const lastVoiceCommandRef = useRef<string | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const viewportRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));

  const { videoElement } = useUserMedia({ isActive: isARActive && !isXRMode });
  const { isInferring, runInference: contextRunInference } = useWebLLM();
  const { setDetectedObjects: setDetected } = useSpatial();
  const { checkTargetFound: contextCheckTargetFound, speak: contextSpeak } = useTaskContext();

  const runInferenceFn = runInference ?? contextRunInference;
  const handleObjectsDetectedFn = onObjectsDetected ?? setDetected;
  const checkTargetFoundFn = checkTargetFound ?? contextCheckTargetFound;
  const speakFn = speak ?? contextSpeak;

  const handleObjectsDetected = useCallback(
    (objects: DetectedObject[]) => {
      handleObjectsDetectedFn(objects);
      
      if (checkTargetFoundFn) {
        checkTargetFoundFn(objects);
      }

      const actions = actionStrings(objects);
 
      if (actions && speakFn) {
        speakFn(actions);
      }
    },
    [handleObjectsDetectedFn, checkTargetFoundFn, speakFn]
  );

  const { captureFrame } = useFrameCapture();

const handleCaptureFrame = useCallback(async (video: HTMLVideoElement | null) => {
    const frame = await captureFrame(video);
    if (frame && sceneImageRef) {
      if (sceneImageRef.current) {
        try {
          sceneImageRef.current.close();
        } catch {}
      }
      sceneImageRef.current = await createImageBitmap(frame);
    }
    return frame;
  }, [captureFrame, sceneImageRef]);

  const { setVideoSource, run, cancelPending } = useInferenceLoop({
    runInference: runInferenceFn,
    captureFrame: handleCaptureFrame,
    onObjectsDetected: handleObjectsDetected,
    isInferring,
    intervalMs: CONFIG.INFERENCE_INTERVAL,
    isActive: isARActive && isModelReady,
  });

  useEffect(() => {
    if (videoElement) {
      setVideoSource(videoElement);
    }
  }, [videoElement, setVideoSource]);

  useEffect(() => {
    if (lastVoiceCommandRef?.current && isModelReady) {
      cancelPending();
      run(lastVoiceCommandRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModelReady, run, cancelPending]);

  if (!isARActive) return null;

  return (
    <>
      <WorldMapRenderer
        detectedObjects={detectedObjects || []}
        worldObjects={worldObjects || []}
        taskActive={taskActive ?? false}
        currentStepTarget={currentStepTarget}
        videoElement={videoElement}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />
    </>
  );
}