'use client';

import React, { useEffect } from 'react';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';
import { DetectedObject3D } from './DetectedObject3D';
import type { WorldObject } from '@/hooks/useWorldMap';
import { getCategoryColor } from '@/utils/objectProcessing';
import { SharedVideoPlane } from './SharedVideoPlane';
import type { DetectedObject } from '@/schemas/vision';

const xrStore = createXRStore();

interface WorldMapRendererProps {
  detectedObjects: DetectedObject[];
  worldObjects: WorldObject[];
  taskActive: boolean;
  currentStepTarget?: string | null;
  videoElement?: HTMLVideoElement | null;
  cameraRef?: React.MutableRefObject<THREE.Camera | null>;
  viewportRef?: React.MutableRefObject<THREE.Vector3>;
}

export function WorldMapRenderer({
  detectedObjects,
  worldObjects,
  taskActive,
  currentStepTarget,
  videoElement,
  cameraRef,
  viewportRef,
}: WorldMapRendererProps) {

  useEffect(() => {
    if (videoElement) {
      const video = videoElement;
      const checkReady = () => {
        if (video.readyState < 2) {
          video.addEventListener('loadedmetadata', checkReady, { once: true });
        }
      };
      checkReady();
    }
  }, [videoElement]);

  const resolvedWorldObjects = worldObjects ?? [];

  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />

      {videoElement ? (
        <SharedVideoPlane video={videoElement} />
      ) : null}

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

      {resolvedWorldObjects.map((obj) => {
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

