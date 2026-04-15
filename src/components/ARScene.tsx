'use client';

import { useRef, useCallback, useEffect } from 'react';
import { XR, createXRStore } from '@react-three/xr';
import { CameraFallback, useFrameCapture } from './CameraFallback';
import { DetectedObject3D } from './DetectedObject3D';
import { useInferenceLoop } from '@/hooks/useInferenceLoop';
import { useWorldMap, type WorldObject, getCategoryColor } from '@/hooks/useWorldMap';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';
import * as THREE from 'three';
import { projectBoundingBoxToWorld } from '@/utils/spatial';

const xrStore = createXRStore();

interface ARSceneProps {
  isARActive: boolean;
  isModelReady: boolean;
  runInference: (
    image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
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
  const { captureFrame } = useFrameCapture();
  const lastVoiceCommandRef = useRef<string | null>(null);
  const { addOrUpdateObject, getAllObjects } = useWorldMap();
  const worldObjectsRef = useRef<WorldObject[]>([]);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const viewportRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));

  useEffect(() => {
    worldObjectsRef.current = getAllObjects();
  }, [getAllObjects]);

  const handleFrameReady = useCallback((video: HTMLVideoElement) => {
    videoRef.current = video;
  }, []);

  const handleObjectsDetected = useCallback(
    (objects: DetectedObject[]) => {
      if (cameraRef.current) {
        objects.forEach((obj) => {
          const position = projectBoundingBoxToWorld(
            { x: obj.bbox_2d[0], y: obj.bbox_2d[1], width: obj.bbox_2d[2], height: obj.bbox_2d[3] },
            {
              camera: cameraRef.current!,
              viewport: viewportRef.current,
              imageWidth: CONFIG.SPATIAL.TARGET_SIZE,
              imageHeight: CONFIG.SPATIAL.TARGET_SIZE,
              depth: CONFIG.SPATIAL.DEFAULT_DEPTH,
            }
          );
          addOrUpdateObject(obj, new THREE.Vector3(position.x, position.y, position.z));
        });
      }
      onObjectsDetected(objects);
    },
    [addOrUpdateObject, onObjectsDetected]
  );

  const { setVideoSource, setActive, executeInference, cancelPending } = useInferenceLoop({
    runInference,
    captureFrame,
    onObjectsDetected: handleObjectsDetected,
    intervalMs: CONFIG.INFERENCE_INTERVAL,
  });

  useEffect(() => {
    setActive(isARActive && isModelReady);
    setVideoSource(videoRef.current);
  }, [isARActive, isModelReady, setActive, setVideoSource]);

  useEffect(() => {
    if (voiceCommand && voiceCommand !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommand;
      cancelPending();
      executeInference(voiceCommand, true);
    }
  }, [voiceCommand, isModelReady, executeInference, cancelPending]);

  if (!isARActive) return null;

  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />

      <CameraFallback isActive={isARActive} onFrameReady={handleFrameReady} />

      {detectedObjects.map((obj, index) => (
        <DetectedObject3D 
          key={`${obj.name}-${index}`} 
          obj={obj} 
          index={index}
          isTarget={taskActive}
          targetName={currentStepTarget}
        />
      ))}

      {worldObjectsRef.current.map((obj) => {
        const categoryColor = getCategoryColor(obj.category);
        return (
          <DetectedObject3D
            key={`world-${obj.id}`}
            obj={{
              name: obj.name,
              bbox_2d: [0, 0, 0, 0],
              action: '',
              category: obj.category,
            }}
            index={0}
            isTarget={false}
            useCategoryColor
            categoryColor={categoryColor}
            position={obj.smoothedPosition}
          />
        );
      })}
    </XR>
  );
}

export function PlaceholderScene() {
  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <mesh position={[0, 0, -3]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="blue" transparent opacity={0.5} />
      </mesh>
    </XR>
  );
}
