'use client';

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldObject } from '@/hooks/useWorldMap';
import { CONFIG } from '@/config';
import { projectPositionToScreen, calculateIndicatorScreenPosition, updateBreadcrumbs, computeBreadcrumbLines, calculateOffScreenIndicator } from '@/utils/indicatorUtils';

const INDICATOR_CONFIG = CONFIG.DIRECTIONAL_INDICATOR;

interface DirectionalIndicatorsProps {
  targets: WorldObject[];
  currentTarget: string | null;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  viewportRef: React.MutableRefObject<THREE.Vector3>;
  breadcrumbs?: boolean;
  showGhostTrail?: boolean;
  anchors?: Map<string, { position: THREE.Vector3; orientation?: THREE.Quaternion }>;
}

interface IndicatorPosition {
  position: THREE.Vector3;
  screenPos: { x: number; y: number };
  isOnScreen: boolean;
  angle: number;
  distance: number;
  isStale?: boolean;
}

interface BreadcrumbPoint {
  position: THREE.Vector3;
  timestamp: number;
}

function resolvePosition(
  obj: WorldObject,
  anchors?: Map<string, { position: THREE.Vector3; orientation?: THREE.Quaternion }>
): THREE.Vector3 {
  if (obj.anchorId && anchors?.has(obj.anchorId)) {
    return anchors.get(obj.anchorId)!.position.clone();
  }
  return obj.smoothedPosition.clone();
}

export function DirectionalIndicators({
  targets,
  currentTarget,
  cameraRef,
  viewportRef,
  breadcrumbs = true,
  showGhostTrail = true,
  anchors,
}: DirectionalIndicatorsProps) {
  const { camera, size } = useThree();
  const tempVector = useMemo(() => new THREE.Vector3(), []);
  const breadcrumbsRef = useRef<Map<string, BreadcrumbPoint[]>>(new Map());

  const indicators = useMemo<IndicatorPosition[]>(() => {
    if (!cameraRef.current || targets.length === 0) return [];

    const cam = cameraRef.current;
    const results: IndicatorPosition[] = [];
    const now = performance.now();

    for (const obj of targets) {
      if (currentTarget && !obj.name.toLowerCase().includes(currentTarget.toLowerCase())) {
        continue;
      }

      const effectivePos = resolvePosition(obj, anchors);
      const screenResult = projectPositionToScreen(effectivePos, cam, size.width, size.height);

      const angle = Math.atan2(screenResult.y / size.height - 0.5, screenResult.x / size.width - 0.5);
      const distance = effectivePos.distanceTo(cam.position);

      if (breadcrumbs && obj.potentiallyMoved) {
        updateBreadcrumbs(
          breadcrumbsRef,
          obj.id,
          obj.smoothedPosition,
          now,
          INDICATOR_CONFIG.MAX_BREADCRUMBS,
          INDICATOR_CONFIG.BREADCRUMB_INTERVAL_MS
        );
      }

      results.push({
        position: obj.smoothedPosition.clone(),
        screenPos: { x: screenResult.x, y: screenResult.y },
        isOnScreen: screenResult.isOnScreen,
        angle,
        distance,
        isStale: obj.potentiallyMoved,
      });
    }

    return results;
  }, [targets, currentTarget, cameraRef, size, breadcrumbs, anchors]);

  const breadcrumbLines = useMemo(() => {
    if (!breadcrumbs) return [];
    return computeBreadcrumbLines(breadcrumbsRef);
  }, [breadcrumbs]);

  const ghostTargets = useMemo(() => {
    if (!showGhostTrail || !cameraRef.current) return [];

    return indicators
      .filter(ind => !ind.isOnScreen && ind.distance < INDICATOR_CONFIG.GHOST_DISTANCE_THRESHOLD)
      .map(ind => {
        const ghostPos = ind.position.clone();
        return {
          position: ghostPos,
          distance: ind.distance,
          targetPos: ind.position.clone(),
        };
      });
  }, [indicators, showGhostTrail, cameraRef]);

  return (
    <>
      {breadcrumbLines.map((line) => (
        <Line
          key={`breadcrumb-${line.id}`}
          points={line.points}
          color="#ff6b00"
          lineWidth={2}
          dashed
          dashScale={2}
          opacity={0.5}
          transparent
        />
      ))}

      {ghostTargets.map((ghost, idx) => (
        <mesh key={`ghost-${idx}`} position={ghost.position}>
          <boxGeometry args={[0.15, 0.15, 0.15]} />
          <meshBasicMaterial
            color="#ff6b00"
            transparent
            opacity={INDICATOR_CONFIG.GHOST_OPACITY}
            wireframe
          />
        </mesh>
      ))}

      {indicators.map((indicator) => {
        if (indicator.isOnScreen) return null;

        const { x: clampedX, y: clampedY, angleToCenter } = calculateIndicatorScreenPosition(
          indicator.screenPos.x,
          indicator.screenPos.y,
          size.width,
          size.height,
          INDICATOR_CONFIG.EDGE_MARGIN
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
              width={INDICATOR_CONFIG.ARROW_SIZE}
              height={INDICATOR_CONFIG.ARROW_SIZE}
              viewBox="0 0 24 24"
              style={{ opacity: indicator.isStale ? 0.5 : 0.8 }}
            >
              <path
                d="M12 2L4 14h6v8l8-12h-6z"
                fill={indicator.isStale ? "#888888" : "#ff6b00"}
                stroke="#ffcc00"
                strokeWidth="1"
              />
            </svg>
            {indicator.distance > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '100%',
                  transform: 'translateX(-50%)',
                  color: indicator.isStale ? '#888' : '#ff6b00',
                  fontSize: '10px',
                  whiteSpace: 'nowrap',
                  fontWeight: 'bold',
                }}
              >
                {indicator.distance.toFixed(1)}m
              </div>
            )}
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
  screenHeight: number,
  breadcrumbs?: THREE.Vector3[]
): { x: number; y: number; angle: number; distance: number; pathPoints: { x: number; y: number }[] } | null {
  return calculateOffScreenIndicator(
    targetPos,
    camera,
    screenWidth,
    screenHeight,
    INDICATOR_CONFIG.EDGE_MARGIN,
    breadcrumbs
  );
}

