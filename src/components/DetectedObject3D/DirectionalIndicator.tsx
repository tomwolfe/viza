'use client';

import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldObject } from '@/hooks/useWorldMap';

interface DirectionalIndicatorsProps {
  targets: WorldObject[];
  currentTarget: string | null;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  viewportRef: React.MutableRefObject<THREE.Vector3>;
}

interface IndicatorPosition {
  position: THREE.Vector3;
  screenPos: { x: number; y: number };
  isOnScreen: boolean;
  angle: number;
  distance: number;
}

const EDGE_MARGIN = 60;
const ARROW_SIZE = 24;

export function DirectionalIndicators({
  targets,
  currentTarget,
  cameraRef,
  viewportRef,
}: DirectionalIndicatorsProps) {
  const { camera, size } = useThree();
  const tempVector = useMemo(() => new THREE.Vector3(), []);
  const tempScreenPos = useMemo(() => new THREE.Vector3(), []);

  const indicators = useMemo<IndicatorPosition[]>(() => {
    if (!cameraRef.current || targets.length === 0) return [];

    const cam = cameraRef.current;
    const results: IndicatorPosition[] = [];

    for (const obj of targets) {
      if (currentTarget && !obj.name.toLowerCase().includes(currentTarget.toLowerCase())) {
        continue;
      }

      tempVector.copy(obj.smoothedPosition);
      tempScreenPos.copy(tempVector).project(cam);

      const isOnScreen =
        tempScreenPos.x >= -1 &&
        tempScreenPos.x <= 1 &&
        tempScreenPos.y >= -1 &&
        tempScreenPos.y <= 1;

      const screenX = (tempScreenPos.x + 1) / 2 * size.width;
      const screenY = (-tempScreenPos.y + 1) / 2 * size.height;

      const angle = Math.atan2(tempScreenPos.y, tempScreenPos.x);
      const distance = tempVector.distanceTo(cam.position);

      results.push({
        position: obj.smoothedPosition.clone(),
        screenPos: { x: screenX, y: screenY },
        isOnScreen,
        angle,
        distance,
      });
    }

    return results;
  }, [targets, currentTarget, cameraRef, size]);

  return (
    <>
      {indicators.map((indicator) => {
        if (indicator.isOnScreen) return null;

        const clampedX = Math.max(
          EDGE_MARGIN,
          Math.min(size.width - EDGE_MARGIN, indicator.screenPos.x)
        );
        const clampedY = Math.max(
          EDGE_MARGIN,
          Math.min(size.height - EDGE_MARGIN, indicator.screenPos.y)
        );

        const angleToCenter = Math.atan2(
          size.height / 2 - clampedY,
          size.width / 2 - clampedX
        );

        return (
          <Html
            key={`indicator-${indicator.position.x}-${indicator.position.z}`}
            position={[0, 0, 0]}
            center
            style={{
              position: 'absolute',
              left: clampedX,
              top: clampedY,
              transform: `translate(-50%, -50%) rotate(${-angleToCenter + Math.PI}rad)`,
              pointerEvents: 'none',
            }}
          >
            <svg
              width={ARROW_SIZE}
              height={ARROW_SIZE}
              viewBox="0 0 24 24"
              style={{ opacity: 0.8 }}
            >
              <path
                d="M12 2L4 14h6v8l8-12h-6z"
                fill="#ff6b00"
                stroke="#ffcc00"
                strokeWidth="1"
              />
            </svg>
          </Html>
        );
      })}
    </>
  );
}

export function getOffScreenIndicator(
  targetPos: THREE.Vector3,
  camera: THREE.Camera,
  screenWidth: number,
  screenHeight: number
): { x: number; y: number; angle: number; distance: number } | null {
  const projected = targetPos.clone().project(camera);

  if (projected.z < 0 || projected.z > 1) {
    return null;
  }

  const screenX = (projected.x + 1) / 2 * screenWidth;
  const screenY = (-projected.y + 1) / 2 * screenHeight;

  const isOnScreen =
    screenX >= 0 && screenX <= screenWidth && screenY >= 0 && screenY <= screenHeight;

  if (isOnScreen) return null;

  const centerX = screenWidth / 2;
  const centerY = screenHeight / 2;

  const dx = screenX - centerX;
  const dy = screenY - centerY;
  const angle = Math.atan2(dy, dx);

  const edgeX =
    dx > 0
      ? Math.min(screenX, screenWidth - EDGE_MARGIN)
      : Math.max(screenX, EDGE_MARGIN);
  const edgeY =
    dy > 0
      ? Math.min(screenY, screenHeight - EDGE_MARGIN)
      : Math.max(screenY, EDGE_MARGIN);

  const clampedEdgeX = Math.abs(dx) > Math.abs(dy)
    ? edgeX
    : dx === 0
    ? centerX
    : centerX + (edgeX - centerX) * Math.abs(dy / dx);
  const clampedEdgeY = Math.abs(dy) > Math.abs(dx)
    ? edgeY
    : dy === 0
    ? centerY
    : centerY + (edgeY - centerY) * Math.abs(dx / dy);

  return {
    x: clampedEdgeX,
    y: clampedEdgeY,
    angle: Math.atan2(screenY - centerY, screenX - centerX),
    distance: targetPos.distanceTo(camera.position),
  };
}