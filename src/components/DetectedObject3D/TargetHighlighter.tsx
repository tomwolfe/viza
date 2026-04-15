'use client';

import { useMemo } from 'react';
import { Float } from '@react-three/drei';

interface TargetHighlighterProps {
  height: number;
}

export function TargetHighlighter({ height }: TargetHighlighterProps) {
  const coneArgs = useMemo(() => [0.15, 0.4, 8] as const, []);
  const position = [0, height / 2 + 0.3, 0] as const;
  const rotation = [Math.PI, 0, 0] as const;

  return (
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
  );
}