'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';
import { DetectedObject3D } from './DetectedObject3D';
import { PooledBoundingBoxes, shouldUsePooling } from './DetectedObject3D/PooledBoundingBox';
import { DirectionalIndicators, getOffScreenIndicator } from './DetectedObject3D/DirectionalIndicator';
import type { WorldObject } from '@/hooks/useWorldMap';
import { getCategoryColor } from '@/utils/objectProcessing';
import { SharedVideoPlane } from './SharedVideoPlane';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';

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
  const [isVideoReady, setIsVideoReady] = useState(false);

  useEffect(() => {
    if (!videoElement) return;
    
    const video = videoElement;
    
    const checkReady = () => {
      if (video.readyState >= 2) {
        setIsVideoReady(true);
        return;
      }
    };
    
    const handleLoadedMetadata = () => {
      if (video.readyState >= 2) {
        setIsVideoReady(true);
      }
    };
    
    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    checkReady();
    
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoElement]);

  const resolvedWorldObjects = useMemo(() => worldObjects ?? [], [worldObjects]);
  const useInstancedRendering = shouldUsePooling(resolvedWorldObjects.length);

  const visibleObjectIds = useMemo(() => {
    const ids = new Set<string>();
    detectedObjects.forEach((obj) => {
      const key = `${obj.name.toLowerCase()}-${Math.floor(obj.bbox_2d[0] / 50)}-${Math.floor(obj.bbox_2d[1] / 50)}`;
      ids.add(key);
    });
    return ids;
  }, [detectedObjects]);

  const pooledBoxData = useMemo(() => {
    if (!useInstancedRendering) return null;

    const boxSizes: Array<{ width: number; height: number }> = [];
    const positions: THREE.Matrix4[] = [];

    resolvedWorldObjects.forEach((obj) => {
      const width = 0.5;
      const height = 0.5;
      boxSizes.push({ width, height });

      const matrix = new THREE.Matrix4();
      matrix.setPosition(obj.smoothedPosition.x, obj.smoothedPosition.y, obj.smoothedPosition.z);
      positions.push(matrix);
    });

    return { boxSizes, positions };
  }, [resolvedWorldObjects, useInstancedRendering]);

  const worldObjectObjects: DetectedObject[] = useMemo(() => {
    return resolvedWorldObjects.map((obj) => ({
      name: obj.name,
      bbox_2d: [0, 0, 0, 0] as [number, number, number, number],
      action: '',
      category: obj.category,
    }));
  }, [resolvedWorldObjects]);

  const isRelevantObject = useCallback((obj: WorldObject): boolean => {
    if (!taskActive || !currentStepTarget) return false;
    return obj.name.toLowerCase().includes(currentStepTarget.toLowerCase());
  }, [taskActive, currentStepTarget]);

  const localCameraRef = useMemo(() => cameraRef ?? { current: null }, [cameraRef]);
  const localViewportRef = useMemo(() => viewportRef ?? { current: new THREE.Vector3(1, 1, 1) }, [viewportRef]);

  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />

      {videoElement && isVideoReady ? (
        <SharedVideoPlane video={videoElement} />
      ) : null}

      {taskActive && currentStepTarget && localCameraRef.current && (
        <DirectionalIndicators
          targets={resolvedWorldObjects}
          currentTarget={currentStepTarget}
          cameraRef={localCameraRef}
          viewportRef={localViewportRef}
        />
      )}

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

      {useInstancedRendering && pooledBoxData ? (
        <PooledBoundingBoxes
          objects={worldObjectObjects}
          boxSizes={pooledBoxData.boxSizes}
          positions={pooledBoxData.positions}
          color={CONFIG.SPATIAL.BOX_COLOR}
          opacity={CONFIG.SPATIAL.BOX_OPACITY}
        />
      ) : (
        resolvedWorldObjects.map((obj) => {
          const categoryColor = getCategoryColor(obj.category);
          const isTarget = !!(taskActive && currentStepTarget && obj.name.toLowerCase().includes(currentStepTarget.toLowerCase()));
          const isGhost = !!(taskActive && !isTarget);
          const isSearching = obj.isOccluded ?? false;
          
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
              isTarget={isTarget}
              useCategoryColor
              categoryColor={categoryColor}
              isGhost={isGhost}
              isSearching={isSearching}
            />
          );
        })
      )}
    </XR>
  );
}

