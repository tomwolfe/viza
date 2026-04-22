'use client';

import { Text } from '@react-three/drei';

import { CONFIG } from '@/config';

interface ObjectLabelProps {
  name: string;
  action?: string;
  width: number;
  height: number;
  color: string;
  isSearching?: boolean;
}

export function ObjectLabel({ name, action, width, height, color, isSearching = false }: ObjectLabelProps) {
  const { SPATIAL } = CONFIG;
  const labelWidth = Math.max(width * 0.9, 0.5);
  const labelScale: [number, number, number] = [labelWidth, 0.25, 1];

  return (
    <group>
      <mesh position={[0, -height / 2 - SPATIAL.LABEL_OFFSET, SPATIAL.LABEL_ZDEPTH]} scale={labelScale}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={SPATIAL.LABEL_BG_COLOR} transparent opacity={SPATIAL.LABEL_BG_OPACITY} />
      </mesh>

      <Text
        position={[0, -height / 2 - SPATIAL.LABEL_OFFSET, SPATIAL.LABEL_TEXT_ZDEPTH]}
        fontSize={SPATIAL.FONT_SIZE}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={SPATIAL.OUTLINE_WIDTH}
        outlineColor={SPATIAL.LABEL_BG_COLOR}
      >
        {isSearching ? `🔍 ${name}` : name}
      </Text>

      {action && (
        <Text
          position={[0, -height / 2 - SPATIAL.ACTION_OFFSET, SPATIAL.LABEL_TEXT_ZDEPTH]}
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