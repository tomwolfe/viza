'use client';

import { Text } from '@react-three/drei';
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
}

export function DetectedObject3D({ obj, index }: DetectedObject3DProps) {
  const { camera, viewport } = useThree();
  const [x, y, width, height] = obj.bbox_2d;

  const { SPATIAL } = CONFIG;
  const worldDepth = SPATIAL.DEFAULT_DEPTH - index * SPATIAL.DEPTH_INCREMENT;

  const cameraPerspective = camera as THREE.PerspectiveCamera;
  const worldPosition = useMemo(
    () =>
      new THREE.Vector3(
        ((x + width / 2) / 512 - 0.5) * viewport.width,
        -((y + height / 2) / 512 - 0.5) * viewport.height,
        worldDepth
      ),
    [x, y, width, height, viewport.width, viewport.height, worldDepth]
  );

  const size = useMemo(
    () =>
      projectBoundingBoxSize(
        { x, y, width, height },
        cameraPerspective,
        512,
        512,
        Math.abs(worldDepth)
      ),
    [x, y, width, height, cameraPerspective, worldDepth]
  );

  const boxWidth = Math.max(size.width, 0.1);
  const boxHeight = Math.max(size.height, 0.1);
  const labelWidth = Math.max(boxWidth * 0.9, 0.5);

  const boxScale = useMemo(() => [boxWidth, boxHeight, 1] as const, [boxWidth, boxHeight]);
  const labelScale = useMemo(() => [labelWidth, 0.25, 1] as const, [labelWidth]);

  return (
    <group position={[worldPosition.x, worldPosition.y, worldPosition.z]}>
      <mesh scale={boxScale}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={SPATIAL.BOX_COLOR}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <lineSegments scale={boxScale}>
        <edgesGeometry args={[PLANE_GEOMETRY]} />
        <lineBasicMaterial color={SPATIAL.BOX_COLOR} linewidth={2} />
      </lineSegments>

      <mesh position={[0, -boxHeight / 2 - SPATIAL.LABEL_OFFSET, 0.01]} scale={labelScale}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={SPATIAL.LABEL_BG_COLOR} transparent opacity={SPATIAL.LABEL_BG_OPACITY} />
      </mesh>

      <Text
        position={[0, -boxHeight / 2 - SPATIAL.LABEL_OFFSET, 0.02]}
        fontSize={SPATIAL.FONT_SIZE}
        color={SPATIAL.BOX_COLOR}
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