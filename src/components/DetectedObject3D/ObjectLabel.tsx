'use client';

import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { CONFIG } from '@/config';

interface ObjectLabelProps {
  name: string;
  action?: string;
  width: number;
  height: number;
  color: string;
}

export function ObjectLabel({ name, action, width, height, color }: ObjectLabelProps) {
  const { SPATIAL } = CONFIG;
  const labelWidth = Math.max(width * 0.9, 0.5);
  const labelScale: [number, number, number] = [labelWidth, 0.25, 1];

  return (
    <group>
      <mesh position={[0, -height / 2 - SPATIAL.LABEL_OFFSET, 0.01]} scale={labelScale}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={SPATIAL.LABEL_BG_COLOR} transparent opacity={SPATIAL.LABEL_BG_OPACITY} />
      </mesh>

      <Text
        position={[0, -height / 2 - SPATIAL.LABEL_OFFSET, 0.02]}
        fontSize={SPATIAL.FONT_SIZE}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={SPATIAL.OUTLINE_WIDTH}
        outlineColor={SPATIAL.LABEL_BG_COLOR}
      >
        {name}
      </Text>

      {action && (
        <Text
          position={[0, -height / 2 - SPATIAL.ACTION_OFFSET, 0.02]}
          fontSize={SPATIAL.ACTION_FONT_SIZE}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={SPATIAL.ACTION_OUTLINE_WIDTH}
          outlineColor={SPATIAL.LABEL_BG_COLOR}
        >
          {action}
        </Text>
      )}
    </group>
  );
}