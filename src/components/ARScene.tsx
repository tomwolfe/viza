'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { WorldMapRenderer } from './WorldMapRenderer';
import { InferenceOrchestrator } from './InferenceOrchestrator';
import { useWorldMap, type WorldObject } from '@/hooks/useWorldMap';
import type { DetectedObject } from '@/schemas/vision';
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
}: ARSceneProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastVoiceCommandRef = useRef<string | null>(null);
  const { getAllObjects } = useWorldMap();
  const [worldObjects, setWorldObjects] = useState<WorldObject[]>([]);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const viewportRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));

  useEffect(() => {
    setWorldObjects(getAllObjects());
  }, [getAllObjects]);

  const handleFrameReady = useCallback((video: HTMLVideoElement) => {
    videoRef.current = video;
  }, []);

  const handleObjectsDetected = useCallback(
    (objects: DetectedObject[]) => {
      onObjectsDetected(objects);
    },
    [onObjectsDetected]
  );

  useEffect(() => {
    if (voiceCommand && voiceCommand !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommand;
    }
  }, [voiceCommand, isModelReady]);

  if (!isARActive) return null;

  return (
    <>
      <InferenceOrchestrator
        runInference={runInference}
        onObjectsDetected={handleObjectsDetected}
        videoRef={videoRef}
        voiceCommand={voiceCommand}
        isARActive={isARActive}
        isModelReady={isModelReady}
      />
      <WorldMapRenderer
        detectedObjects={detectedObjects}
        worldObjects={worldObjects}
        taskActive={taskActive ?? false}
        currentStepTarget={currentStepTarget}
        onFrameReady={handleFrameReady}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />
    </>
  );
}