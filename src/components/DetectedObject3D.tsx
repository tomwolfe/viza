'use client';

import { Text } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { projectBoundingBoxSize } from '@/utils/spatial';

interface DetectedObject3DProps {
  obj: DetectedObject;
  index: number;
}

export function DetectedObject3D({ obj, index }: DetectedObject3DProps) {
  const { camera, viewport } = useThree();
  const [x, y, width, height] = obj.bbox_2d;

  const worldDepth = -3 - index * 0.5;

  const cameraPerspective = camera as THREE.PerspectiveCamera;
  const worldPosition = new THREE.Vector3(
    ((x + width / 2) / 512 - 0.5) * viewport.width,
    -((y + height / 2) / 512 - 0.5) * viewport.height,
    worldDepth
  );

  const size = projectBoundingBoxSize(
    { x, y, width, height },
    cameraPerspective,
    512,
    512,
    Math.abs(worldDepth)
  );

  const boxWidth = Math.max(size.width, 0.1);
  const boxHeight = Math.max(size.height, 0.1);
  const labelWidth = Math.max(boxWidth * 0.9, 0.5);

  return (
    <group position={[worldPosition.x, worldPosition.y, worldPosition.z]}>
      <mesh>
        <planeGeometry args={[boxWidth, boxHeight]} />
        <meshBasicMaterial
          color="#00ff88"
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(boxWidth, boxHeight)]} />
        <lineBasicMaterial color="#00ff88" linewidth={2} />
      </lineSegments>

      <mesh position={[0, -boxHeight / 2 - 0.15, 0.01]}>
        <planeGeometry args={[labelWidth, 0.25]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.7} />
      </mesh>

      <Text
        position={[0, -boxHeight / 2 - 0.15, 0.02]}
        fontSize={0.12}
        color="#00ff88"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {obj.name}
      </Text>

      {obj.action && (
        <Text
          position={[0, -boxHeight / 2 - 0.3, 0.02]}
          fontSize={0.08}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#000000"
        >
          {obj.action}
        </Text>
      )}
    </group>
  );
}