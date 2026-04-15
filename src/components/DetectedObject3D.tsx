'use client';

import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { projectBoundingBoxSize, get3DPosition } from '@/utils/spatial';
import { CONFIG } from '@/config';
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

export function DetectedObject3D({ obj, index, isTarget, targetName, useCategoryColor, categoryColor, position }: DetectedObject3DProps) {
  const { camera, viewport } = useThree();
  const [x, y, width, height] = obj.bbox_2d;

  const { SPATIAL } = CONFIG;
  const targetSize = SPATIAL.TARGET_SIZE;
  const worldDepth = SPATIAL.DEFAULT_DEPTH - index * SPATIAL.DEPTH_INCREMENT;

  const cameraPerspective = camera as THREE.PerspectiveCamera;

  const worldPosition = useMemo(
    () => {
      if (position) {
        return position;
      }
      return get3DPosition(
        x,
        y,
        width,
        height,
        cameraPerspective,
        { width: viewport.width, height: viewport.height },
        targetSize,
        worldDepth
      );
    },
    [position, x, y, width, height, cameraPerspective, viewport.width, viewport.height, worldDepth, targetSize]
  );

  const size = useMemo(
    () =>
      projectBoundingBoxSize(
        { x, y, width, height },
        cameraPerspective,
        targetSize,
        targetSize,
        Math.abs(worldDepth)
      ),
    [x, y, width, height, cameraPerspective, worldDepth, targetSize]
  );

  const boxWidth = Math.max(size.width, 0.1);
  const boxHeight = Math.max(size.height, 0.1);

  const isCurrentTarget = isTarget && targetName && obj.name.toLowerCase().includes(targetName.toLowerCase());
  const displayColor = useCategoryColor && categoryColor
    ? categoryColor
    : (isCurrentTarget ? '#ff6b00' : SPATIAL.BOX_COLOR);

  return (
    <group position={[worldPosition.x, worldPosition.y, worldPosition.z]}>
      <BoundingBox
        width={boxWidth}
        height={boxHeight}
        color={displayColor}
        opacity={isCurrentTarget ? 0.3 : 0.15}
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
}