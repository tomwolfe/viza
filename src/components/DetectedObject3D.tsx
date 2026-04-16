'use client';

import { memo } from 'react';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';
import { useObject3DTransform } from '@/hooks/useObject3DTransform';
import { BoundingBox } from './DetectedObject3D/BoundingBox';
import { ObjectLabel } from './DetectedObject3D/ObjectLabel';
import { TargetHighlighter } from './DetectedObject3D/TargetHighlighter';

interface DetectedObject3DProps {
  obj: DetectedObject;
  index: number;
  isTarget?: boolean;
  targetName?: string;
  useCategoryColor?: boolean;
  categoryColor?: string;
  position?: THREE.Vector3;
}

export const DetectedObject3D = memo(function DetectedObject3D({ obj, index, isTarget, targetName, useCategoryColor, categoryColor, position }: DetectedObject3DProps) {
  const { worldPosition, boxWidth, boxHeight } = useObject3DTransform({ obj, index, position });

  const isCurrentTarget = isTarget && targetName && obj.name.toLowerCase().includes(targetName.toLowerCase());
  const displayColor = useCategoryColor && categoryColor
    ? categoryColor
    : (isCurrentTarget ? '#ff6b00' : CONFIG.SPATIAL.BOX_COLOR);

  return (
    <group position={[worldPosition.x, worldPosition.y, worldPosition.z]}>
      <BoundingBox
        width={boxWidth}
        height={boxHeight}
        color={displayColor}
        opacity={isCurrentTarget ? CONFIG.SPATIAL.HIGHLIGHT_OPACITY : CONFIG.SPATIAL.BOX_OPACITY}
      />

      {isCurrentTarget && <TargetHighlighter height={boxHeight} />}

      <ObjectLabel
        name={obj.name}
        action={obj.action}
        width={boxWidth}
        height={boxHeight}
        color={displayColor}
      />
    </group>
  );
});