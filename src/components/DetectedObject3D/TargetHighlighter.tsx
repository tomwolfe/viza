'use client';

import { Float } from '@react-three/drei';

interface TargetHighlighterProps {
  height: number;
}

export function TargetHighlighter({ height }: TargetHighlighterProps) {
  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <mesh position={[0, height / 2 + 0.3, 0]}>
        <coneGeometry args={[0.15, 0.4, 8]} />
        <meshBasicMaterial color="#ff6b00" transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, height / 2 + 0.3, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.15, 0.4, 8]} />
        <meshBasicMaterial color="#ffcc00" transparent opacity={0.6} />
      </mesh>
    </Float>
  );
}