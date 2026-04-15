'use client';

import { Text } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DetectedObject } from '@/hooks/useWebLLM';
import { CONFIG } from '@/config';

interface DetectedObject3DProps {
  obj: DetectedObject;
  index: number;
}

const BBOX_SIZE = CONFIG.TARGET_SIZE;

export function DetectedObject3D({ obj, index }: DetectedObject3DProps) {
  const { viewport } = useThree();
  const [x, y, width, height] = obj.bbox_2d;

  const worldX = ((x + width / 2) / BBOX_SIZE - 0.5) * viewport.width;
  const worldY = -((y + height / 2) / BBOX_SIZE - 0.5) * viewport.height;
  const worldZ = -3 - index * 0.5;

  const boxWidth = (width / BBOX_SIZE) * viewport.width;
  const boxHeight = (height / BBOX_SIZE) * viewport.height;
  const labelWidth = Math.max(boxWidth * 0.9, 0.5);

  return (
    <group position={[worldX, worldY, worldZ]}>
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