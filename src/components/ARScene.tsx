'use client';

import { useRef, useCallback, useEffect, useState, useImperativeHandle } from 'react';
import { WorldMapRenderer } from './WorldMapRenderer';
import { useInferenceLoop } from '@/hooks/useInferenceLoop';
import { useFrameCapture } from '@/hooks/useFrameCapture';
import { useWorldMap, type WorldObject } from '@/hooks/useWorldMap';
import { useUserMedia } from '@/hooks/useUserMedia';
import { useWebLLM } from '@/contexts/WebLLMContext';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';
import * as THREE from 'three';

interface ARSceneProps {
  isARActive: boolean;
  isModelReady: boolean;
  runInference: (
    image: ImageBitmap,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  detectedObjects: DetectedObject[];
  onObjectsDetected: (objects: DetectedObject[]) => void;
  voiceCommandRef?: React.RefObject<string | null>;
  taskActive?: boolean;
  currentStepTarget?: string;
  checkTargetFound?: (objects: DetectedObject[]) => void;
  speak?: (text: string) => void;
  isXRMode?: boolean;
  sceneImageRef?: React.MutableRefObject<ImageBitmap | null>;
}

export interface ARSceneHandle {
  runVoiceCommand: (command: string) => void;
}

export function ARScene({
  isARActive,
  isModelReady,
  runInference,
  detectedObjects,
  onObjectsDetected,
  voiceCommandRef,
  taskActive,
  currentStepTarget,
  checkTargetFound,
  speak,
  isXRMode = false,
  sceneImageRef,
}: ARSceneProps) {
  const lastVoiceCommandRef = useRef<string | null>(null);
  const { getAllObjects } = useWorldMap();
  const [worldObjects, setWorldObjects] = useState<WorldObject[]>([]);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const viewportRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));

  const { videoElement } = useUserMedia({ isActive: isARActive && isModelReady && !isXRMode });
  const { isInferring } = useWebLLM();

  useEffect(() => {
    setWorldObjects(getAllObjects());
  }, [getAllObjects]);

  const handleObjectsDetected = useCallback(
    (objects: DetectedObject[]) => {
      onObjectsDetected(objects);
      
      if (checkTargetFound) {
        checkTargetFound(objects);
      }

      const actions = objects
        .filter(obj => obj.action)
        .map(obj => `${obj.name}: ${obj.action}`)
        .join('. ');

      if (actions && speak) {
        speak(actions);
      }
    },
    [onObjectsDetected, checkTargetFound, speak]
  );

  const { captureFrame } = useFrameCapture();

  const handleCaptureFrame = useCallback(async (video: HTMLVideoElement | null) => {
    const frame = await captureFrame(video);
    if (frame && sceneImageRef) {
      // Update the shared ref for planning
      if (sceneImageRef.current) {
        sceneImageRef.current.close();
      }
      // Create a copy for the ref to avoid closing it when inference is done
      // Actually ImageBitmap is transferable, but if we want to keep it we might need to clone it
      // or just manage its lifecycle carefully.
      // Since runInference might close it, we should probably clone it if we want to keep it.
      // But createImageBitmap from ImageBitmap is a way to clone it.
      sceneImageRef.current = await createImageBitmap(frame);
    }
    return frame;
  }, [captureFrame, sceneImageRef]);

  const { setVideoSource, run, cancelPending } = useInferenceLoop({
    runInference,
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
    if (voiceCommandRef?.current && voiceCommandRef.current !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommandRef.current;
      cancelPending();
      run(voiceCommandRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModelReady, run, cancelPending]);

  const runVoiceCommand = useCallback((command: string) => {
    if (isModelReady && command) {
      lastVoiceCommandRef.current = command;
      cancelPending();
      run(command);
    }
  }, [isModelReady, run, cancelPending]);

  useImperativeHandle(
    useRef<ARSceneHandle | null>(null),
    () => ({ runVoiceCommand }),
    [runVoiceCommand]
  );

  if (!isARActive) return null;

  return (
    <>
      <WorldMapRenderer
        detectedObjects={detectedObjects}
        worldObjects={worldObjects}
        taskActive={taskActive ?? false}
        currentStepTarget={currentStepTarget}
        videoElement={videoElement}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />
    </>
  );
}