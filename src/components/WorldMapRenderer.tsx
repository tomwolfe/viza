'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { XR, createXRStore } from '@react-three/xr';
import { useThree } from '@react-three/fiber';
import { DetectedObject3D } from './DetectedObject3D';
import { useWorldMap, type WorldObject, getCategoryColor } from '@/hooks/useWorldMap';
import type { DetectedObject } from '@/schemas/vision';
import * as THREE from 'three';

const xrStore = createXRStore();

interface WorldMapRendererProps {
  detectedObjects: DetectedObject[];
  worldObjects?: WorldObject[];
  taskActive: boolean;
  currentStepTarget?: string | null;
  videoElement?: HTMLVideoElement | null;
  cameraRef?: React.MutableRefObject<THREE.Camera | null>;
  viewportRef?: React.MutableRefObject<THREE.Vector3>;
  hitTestResult?: unknown;
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
  const { getAllObjects } = useWorldMap();
  const [worldObjectsState, setWorldObjectsState] = useState<WorldObject[]>([]);

  useEffect(() => {
    setWorldObjectsState(getAllObjects());
  }, [getAllObjects, worldObjects]);

  useEffect(() => {
    if (videoElement) {
      const video = videoElement;
      const checkReady = () => {
        if (video.readyState >= 2) {
        } else {
          video.addEventListener('loadedmetadata', checkReady, { once: true });
        }
      };
      checkReady();
    }
  }, [videoElement]);

  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />

      {videoElement ? (
        <VideoPlane video={videoElement} />
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

interface VideoPlaneProps {
  video: HTMLVideoElement;
}

function VideoPlane({ video }: VideoPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { viewport } = useThree();

  const texture = useMemo(() => {
    const newTexture = new THREE.VideoTexture(video);
    newTexture.minFilter = THREE.LinearFilter;
    newTexture.magFilter = THREE.LinearFilter;
    newTexture.format = THREE.RGBAFormat;
    newTexture.colorSpace = THREE.SRGBColorSpace;
    return newTexture;
  }, [video]);

  const planeScale: [number, number, number] = useMemo(() => {
    return [viewport.width, viewport.height, 1];
  }, [viewport.width, viewport.height]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <mesh ref={meshRef} position={[0, 0, -5]} scale={planeScale}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}