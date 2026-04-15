'use client';

import { Text, Float } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { projectBoundingBoxSize } from '@/utils/spatial';
import { CONFIG } from '@/config';

const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);

interface DetectedObject3DProps {
  obj: DetectedObject;
  index: number;
  isTarget?: boolean;
  targetName?: string;
  useCategoryColor?: boolean;
  categoryColor?: string;
  position?: THREE.Vector3;
}

export function DetectedObject3D({ obj, index, isTarget, targetName, useCategoryColor, categoryColor, position }: DetectedObject3DProps) {
  const { camera, viewport } = useThree();
  const [x, y, width, height] = obj.bbox_2d;

  const { SPATIAL } = CONFIG;
  const targetSize = SPATIAL.TARGET_SIZE;
  const worldDepth = SPATIAL.DEFAULT_DEPTH - index * SPATIAL.DEPTH_INCREMENT;

  const cameraPerspective = camera as THREE.PerspectiveCamera;

  const aspect = viewport.width / viewport.height;
  const scale = aspect > 1 ? 1 : aspect;
  const offsetX = aspect > 1 ? 0 : (1 - scale) / 2;
  const offsetY = aspect > 1 ? (1 - scale) / 2 : 0;

  const worldPosition = useMemo(
    () => {
      if (position) {
        return position;
      }
      return new THREE.Vector3(
        ((x / targetSize) - offsetX) / scale * viewport.width,
        -(((y / targetSize) - offsetY) / scale * viewport.height),
        worldDepth
      );
    },
    [position, x, y, viewport.width, viewport.height, worldDepth, targetSize, scale, offsetX, offsetY]
  );

  const size = useMemo(
    () =>
      projectBoundingBoxSize(
        { x, y, width, height },
        cameraPerspective,
        targetSize,
        targetSize,
        Math.abs(worldDepth)
      ),
    [x, y, width, height, cameraPerspective, worldDepth, targetSize]
  );

  const boxWidth = Math.max(size.width, 0.1);
  const boxHeight = Math.max(size.height, 0.1);
  const labelWidth = Math.max(boxWidth * 0.9, 0.5);

  const boxScale = useMemo(() => [boxWidth, boxHeight, 1] as const, [boxWidth, boxHeight]);
  const labelScale = useMemo(() => [labelWidth, 0.25, 1] as const, [labelWidth]);

  const isCurrentTarget = isTarget && targetName && obj.name.toLowerCase().includes(targetName.toLowerCase());
  const displayColor = useCategoryColor && categoryColor 
    ? categoryColor 
    : (isCurrentTarget ? '#ff6b00' : SPATIAL.BOX_COLOR);

  return (
    <group position={[worldPosition.x, worldPosition.y, worldPosition.z]}>
      <mesh scale={boxScale}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={displayColor}
          transparent
          opacity={isCurrentTarget ? 0.3 : 0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <lineSegments scale={boxScale}>
        <edgesGeometry args={[PLANE_GEOMETRY]} />
        <lineBasicMaterial color={displayColor} linewidth={2} />
      </lineSegments>

      {isCurrentTarget && (
        <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
          <mesh position={[0, boxHeight / 2 + 0.3, 0]}>
            <coneGeometry args={[0.15, 0.4, 8]} />
            <meshBasicMaterial color="#ff6b00" transparent opacity={0.8} />
          </mesh>
          <mesh position={[0, boxHeight / 2 + 0.3, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.15, 0.4, 8]} />
            <meshBasicMaterial color="#ffcc00" transparent opacity={0.6} />
          </mesh>
        </Float>
      )}

      <mesh position={[0, -boxHeight / 2 - SPATIAL.LABEL_OFFSET, 0.01]} scale={labelScale}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={SPATIAL.LABEL_BG_COLOR} transparent opacity={SPATIAL.LABEL_BG_OPACITY} />
      </mesh>

      <Text
        position={[0, -boxHeight / 2 - SPATIAL.LABEL_OFFSET, 0.02]}
        fontSize={SPATIAL.FONT_SIZE}
        color={displayColor}
        anchorX="center"
        anchorY="middle"
        outlineWidth={SPATIAL.OUTLINE_WIDTH}
        outlineColor={SPATIAL.LABEL_BG_COLOR}
      >
        {obj.name}
      </Text>

      {obj.action && (
        <Text
          position={[0, -boxHeight / 2 - SPATIAL.ACTION_OFFSET, 0.02]}
          fontSize={SPATIAL.ACTION_FONT_SIZE}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={SPATIAL.ACTION_OUTLINE_WIDTH}
          outlineColor={SPATIAL.LABEL_BG_COLOR}
        >
          {obj.action}
        </Text>
      )}
    </group>
  );
}