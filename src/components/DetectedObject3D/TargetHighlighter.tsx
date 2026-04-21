'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import { CONFIG } from '@/config';

interface TargetHighlighterProps {
  height: number;
}

export function TargetHighlighter({ height }: TargetHighlighterProps) {
  const { SPATIAL } = CONFIG;
  const coneArgs = useMemo(() => [SPATIAL.HIGHLIGHTER_CONE_WIDTH, SPATIAL.HIGHLIGHTER_CONE_HEIGHT, 8] as const, [SPATIAL.HIGHLIGHTER_CONE_WIDTH, SPATIAL.HIGHLIGHTER_CONE_HEIGHT]);
  const position = [0, height / 2 + SPATIAL.HIGHLIGHTER_OFFSET, 0] as const;
  const rotation = [Math.PI, 0, 0] as const;

  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!ringRef.current) return;
    const material = ringRef.current.material as THREE.MeshBasicMaterial;
    const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.2;
    ringRef.current.scale.set(scale, scale, 1);
    material.opacity = 0.5 + Math.sin(state.clock.elapsedTime * 3) * 0.3;
  });

  return (
    <group>
      <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
        <mesh position={position}>
          <coneGeometry args={coneArgs} />
          <meshBasicMaterial color="#ff6b00" transparent opacity={0.8} />
        </mesh>
        <mesh position={position} rotation={rotation}>
          <coneGeometry args={coneArgs} />
          <meshBasicMaterial color="#ffcc00" transparent opacity={0.6} />
        </mesh>
      </Float>

      <mesh ref={ringRef} position={[0, height / 2 + SPATIAL.HIGHLIGHTER_OFFSET * 2, 0]}>
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial color="#ff6b00" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}