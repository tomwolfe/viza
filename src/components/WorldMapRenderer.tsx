'use client';

import React, { useEffect, useState } from 'react';
import { XR, createXRStore } from '@react-three/xr';
import { DetectedObject3D } from './DetectedObject3D';
import { CameraFallback } from './CameraFallback';
import { useWorldMap, type WorldObject, getCategoryColor } from '@/hooks/useWorldMap';
import type { DetectedObject } from '@/schemas/vision';
import * as THREE from 'three';

const xrStore = createXRStore();

interface WorldMapRendererProps {
  detectedObjects: DetectedObject[];
  worldObjects?: WorldObject[];
  taskActive: boolean;
  currentStepTarget?: string | null;
  onFrameReady: (video: HTMLVideoElement) => void;
  cameraRef?: React.MutableRefObject<THREE.Camera | null>;
  viewportRef?: React.MutableRefObject<THREE.Vector3>;
  hitTestResult?: unknown;
}

export function WorldMapRenderer({
  detectedObjects,
  worldObjects,
  taskActive,
  currentStepTarget,
  onFrameReady,
}: WorldMapRendererProps) {
  const { getAllObjects } = useWorldMap();
  const [worldObjectsState, setWorldObjectsState] = useState<WorldObject[]>([]);

  useEffect(() => {
    setWorldObjectsState(getAllObjects());
  }, [getAllObjects, worldObjects]);

  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />

      <CameraFallback isActive onFrameReady={onFrameReady} />

      {detectedObjects.map((obj, index) => {
        return (
          <DetectedObject3D
            key={`${obj.name}-${index}`}
            obj={obj}
            index={index}
            isTarget={taskActive}
            targetName={currentStepTarget ?? undefined}
          />
        );
      })}

      {worldObjectsState.map((obj) => {
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
            position={obj.smoothedPosition}
            isTarget={false}
            useCategoryColor
            categoryColor={categoryColor}
          />
        );
      })}
    </XR>
  );
}