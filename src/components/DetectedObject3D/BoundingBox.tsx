'use client';

import * as THREE from 'three';
import { CONFIG } from '@/config';

const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);

interface BoundingBoxProps {
  width: number;
  height: number;
  color: string;
  opacity?: number;
}

export function BoundingBox({ width, height, color, opacity = 0.15 }: BoundingBoxProps) {
  const boxWidth = Math.max(width, 0.1);
  const boxHeight = Math.max(height, 0.1);
  const boxScale: [number, number, number] = [boxWidth, boxHeight, 1];

  return (
    <group>
      <mesh scale={boxScale}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <lineSegments scale={boxScale}>
        <edgesGeometry args={[PLANE_GEOMETRY]} />
        <lineBasicMaterial color={color} linewidth={2} />
      </lineSegments>
    </group>
  );
}