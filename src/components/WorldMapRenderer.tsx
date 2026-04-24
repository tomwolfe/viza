'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';
import { DetectedObject3D } from './DetectedObject3D';
import { PooledBoundingBoxes } from './DetectedObject3D/PooledBoundingBox';
import { DirectionalIndicators } from './DetectedObject3D/DirectionalIndicator';
import type { WorldObject } from '@/hooks/useWorldMap';
import { getCategoryColor } from '@/utils/objectProcessing';
import { SharedVideoPlane } from './SharedVideoPlane';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';
import type { HitTestResult } from '@/utils/spatial';

const xrStore = createXRStore();

interface WorldMapRendererProps {
  detectedObjects: DetectedObject[];
  worldObjects: WorldObject[];
  taskActive: boolean;
  currentStepTarget?: string | null;
  videoElement?: HTMLVideoElement | null;
  cameraRef?: React.MutableRefObject<THREE.Camera | null>;
  viewportRef?: React.MutableRefObject<THREE.Vector3>;
  anchors?: Map<string, { position: THREE.Vector3; orientation?: THREE.Quaternion }>;
  hitTestResult?: HitTestResult | null;
}

function resolveObjectPosition(
  obj: WorldObject,
  anchors?: Map<string, { position: THREE.Vector3; orientation?: THREE.Quaternion }>
): THREE.Vector3 {
  if (obj.anchorId && anchors?.has(obj.anchorId)) {
    return anchors.get(obj.anchorId)!.position.clone();
  }
  return obj.smoothedPosition.clone();
}

export function WorldMapRenderer({
  detectedObjects,
  worldObjects,
  taskActive,
  currentStepTarget,
  videoElement,
  cameraRef,
  viewportRef,
  anchors,
  hitTestResult,
}: WorldMapRendererProps) {
  const [isVideoReady, setIsVideoReady] = useState(false);

  useEffect(() => {
    if (!videoElement) return;
    
    const video = videoElement;
    
    const checkReady = () => {
      if (video.readyState >= 2) {
        setIsVideoReady(true);
      }
    };
    
    video.addEventListener('loadeddata', checkReady);
    video.addEventListener('playing', checkReady);
    video.addEventListener('timeupdate', checkReady);
    checkReady();
    
    return () => {
      video.removeEventListener('loadeddata', checkReady);
      video.removeEventListener('playing', checkReady);
      video.removeEventListener('timeupdate', checkReady);
    };
  }, [videoElement]);

  const resolvedWorldObjects = useMemo(() => worldObjects ?? [], [worldObjects]);
  const resolvedAnchors = useMemo(() => anchors, [anchors]);
  const localCameraRef = useMemo(() => cameraRef ?? { current: null }, [cameraRef]);
  const localViewportRef = useMemo(() => viewportRef ?? { current: new THREE.Vector3(1, 1, 1) }, [viewportRef]);

  const enrichedWorldObjects = useMemo(() => {
    return resolvedWorldObjects.map((obj) => {
      const categoryColor = getCategoryColor(obj.category);
      const isTarget = !!(taskActive && currentStepTarget && obj.name.toLowerCase().includes(currentStepTarget.toLowerCase()));
      const isGhost = !!(taskActive && !isTarget);
      const isSearching = obj.isOccluded ?? false;
      const effectivePos = resolveObjectPosition(obj, resolvedAnchors);
      
      return {
        ...obj,
        categoryColor,
        isTarget,
        isGhost,
        isSearching,
        effectivePos
      };
    });
  }, [resolvedWorldObjects, taskActive, currentStepTarget, resolvedAnchors]);

  const nonTargetWorldObjects = useMemo(() => {
    return enrichedWorldObjects.filter(obj => !obj.isTarget);
  }, [enrichedWorldObjects]);

  const targetWorldObjects = useMemo(() => {
    return enrichedWorldObjects.filter(obj => obj.isTarget);
  }, [enrichedWorldObjects]);

  const nonTargetBoxData = useMemo(() => {
    const boxSizes: Array<{ width: number; height: number }> = [];
    const positions: THREE.Matrix4[] = [];

    nonTargetWorldObjects.forEach((obj) => {
      boxSizes.push({ width: 0.5, height: 0.5 });
      const matrix = new THREE.Matrix4();
      matrix.setPosition(obj.effectivePos.x, obj.effectivePos.y, obj.effectivePos.z);
      positions.push(matrix);
    });

    return { boxSizes, positions };
  }, [nonTargetWorldObjects]);

  const nonTargetVisionObjects = useMemo(() => {
    return nonTargetWorldObjects.map(obj => ({
      name: obj.name,
      bbox_2d: [0, 0, 0, 0] as [number, number, number, number],
      action: '',
      category: obj.category,
    }));
  }, [nonTargetWorldObjects]);

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
          anchors={resolvedAnchors}
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
            hitTestResult={hitTestResult}
          />
        );
      })}

      {nonTargetWorldObjects.length > 0 && (
        <PooledBoundingBoxes
          objects={nonTargetVisionObjects}
          boxSizes={nonTargetBoxData.boxSizes}
          positions={nonTargetBoxData.positions}
          color={CONFIG.SPATIAL.BOX_COLOR}
          opacity={CONFIG.SPATIAL.BOX_OPACITY * 0.5}
        />
      )}

      {targetWorldObjects.map((obj) => {
        return (
          <DetectedObject3D
            key={`world-target-${obj.id}`}
            obj={{
              name: obj.name,
              bbox_2d: [0, 0, 0, 0],
              action: '',
              category: obj.category,
            }}
            index={0}
            position={obj.effectivePos}
            isTarget={true}
            useCategoryColor
            categoryColor={obj.categoryColor}
            isGhost={false}
            isSearching={obj.isSearching}
            hitTestResult={hitTestResult}
          />
        );
      })}
    </XR>
  );
}
