'use client';

import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { WorldMapRenderer } from './WorldMapRenderer';
import { useSceneInference } from '@/hooks/useSceneInference';
import { useTaskContext } from '@/contexts/TaskContext';
import type { DetectedObject } from '@/schemas/vision';
import type { WorldObject } from '@/hooks/useWorldMap';
import * as THREE from 'three';

interface ARSceneProps {
  isARActive: boolean;
  isModelReady: boolean;
  runInference?: (
    _image: ImageBitmap,
    _prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  detectedObjects?: DetectedObject[];
  worldObjects?: WorldObject[];
  onObjectsDetected?: (_objects: DetectedObject[]) => void;
  taskActive?: boolean;
  currentStepTarget?: string;
  checkTargetFound?: (_objects: DetectedObject[]) => void;
  speak?: (_text: string) => void;
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
  const cameraRef = useRef<THREE.Camera | null>(null);
  const viewportRef = useRef(new THREE.Vector3(1, 1, 1));

  const { camera, size } = useThree();

  useEffect(() => {
    cameraRef.current = camera;
    viewportRef.current = new THREE.Vector3(size.width, size.height, 1);
  }, [camera, size]);

  const { checkTargetFound: contextCheckTargetFound, speak: contextSpeak } = useTaskContext();

  const setDetectedObjects = onObjectsDetected || (() => {});

  const { videoElement, setVideoSource } = useSceneInference({
    isARActive,
    isModelReady,
    runInference: runInference!,
    setDetectedObjects,
    checkTargetFound: checkTargetFound ?? contextCheckTargetFound,
    speak: speak ?? contextSpeak,
    isXRMode,
    sceneImageRef,
    isInferring: false,
  });

  useEffect(() => {
    if (videoElement) {
      setVideoSource(videoElement);
    }
  }, [videoElement, setVideoSource]);

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