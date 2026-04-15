'use client';

import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { DetectedObject } from '@/hooks/useWebLLM';

interface DetectedObject3DProps {
  obj: DetectedObject;
  index: number;
}

export function DetectedObject3D({ obj, index }: DetectedObject3DProps) {
  const [x, y, width, height] = obj.bbox_2d;

  const worldX = ((x + width / 2) / 512 - 0.5) * 4;
  const worldY = -((y + height / 2) / 512 - 0.5) * 3;
  const worldZ = -3 - index * 0.5;

  const boxWidth = (width / 512) * 4;
  const boxHeight = (height / 512) * 3;

  const planeGeom = useMemo(() => new THREE.PlaneGeometry(boxWidth, boxHeight), [boxWidth, boxHeight]);
  const edgeGeom = useMemo(() => new THREE.EdgesGeometry(planeGeom), [planeGeom]);

  return (
    <group position={[worldX, worldY, worldZ]}>
      <mesh>
        <primitive object={planeGeom} attach="geometry" />
        <meshBasicMaterial
          color="#00ff88"
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <lineSegments>
        <primitive object={edgeGeom} attach="geometry" />
        <lineBasicMaterial color="#00ff88" linewidth={2} />
      </lineSegments>

      <mesh position={[0, -boxHeight / 2 - 0.15, 0.01]}>
        <planeGeometry args={[Math.max(boxWidth * 0.9, 0.5), 0.25]} />
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