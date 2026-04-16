'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { WorldMapRenderer } from './WorldMapRenderer';
import { useInferenceLoop } from '@/hooks/useInferenceLoop';
import { useFrameCapture } from '@/hooks/useFrameCapture';
import { useWorldMap, type WorldObject } from '@/hooks/useWorldMap';
import { useCamera } from '@/hooks/useCamera';
import { useWebLLM } from '@/contexts/WebLLMContext';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG, logger } from '@/config';
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
  voiceCommand?: string | null;
  taskActive?: boolean;
  currentStepTarget?: string;
  checkTargetFound?: (objects: DetectedObject[]) => void;
  speak?: (text: string) => void;
}

export function ARScene({
  isARActive,
  isModelReady,
  runInference,
  detectedObjects,
  onObjectsDetected,
  voiceCommand,
  taskActive,
  currentStepTarget,
  checkTargetFound,
  speak,
}: ARSceneProps) {
  const lastVoiceCommandRef = useRef<string | null>(null);
  const { getAllObjects } = useWorldMap();
  const [worldObjects, setWorldObjects] = useState<WorldObject[]>([]);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const viewportRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));

  const { videoElement } = useCamera({ isActive: isARActive && isModelReady });
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

  useEffect(() => {
    if (voiceCommand && voiceCommand !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommand;
    }
  }, [voiceCommand, isModelReady]);

  const { captureFrame } = useFrameCapture();
  const { setVideoSource, run, cancelPending } = useInferenceLoop({
    runInference,
    captureFrame,
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
    if (voiceCommand && voiceCommand !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommand;
      cancelPending();
      run(voiceCommand);
    }
  }, [voiceCommand, isModelReady, run, cancelPending]);

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