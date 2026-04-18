'use client';

import { useMemo } from 'react';
import { Float } from '@react-three/drei';
import { CONFIG } from '@/config';

interface TargetHighlighterProps {
  height: number;
}

export function TargetHighlighter({ height }: TargetHighlighterProps) {
  const { SPATIAL } = CONFIG;
  const coneArgs = useMemo(() => [SPATIAL.HIGHLIGHTER_CONE_WIDTH, SPATIAL.HIGHLIGHTER_CONE_HEIGHT, 8] as const, [SPATIAL.HIGHLIGHTER_CONE_WIDTH, SPATIAL.HIGHLIGHTER_CONE_HEIGHT]);
  const position = [0, height / 2 + SPATIAL.HIGHLIGHTER_OFFSET, 0] as const;
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