'use client';

import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { projectBoundingBoxSize, get3DPosition } from '@/utils/spatial';
import { CONFIG } from '@/config';

interface UseObject3DTransformOptions {
  obj: DetectedObject;
  index: number;
  position?: THREE.Vector3;
}

export function useObject3DTransform({ obj, index, position }: UseObject3DTransformOptions) {
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

  const boxWidth = Math.max(size.width, SPATIAL.MIN_BOX_SIZE);
  const boxHeight = Math.max(size.height, SPATIAL.MIN_BOX_SIZE);

  return {
    x,
    y,
    width,
    height,
    worldDepth,
    targetSize,
    worldPosition,
    boxWidth,
    boxHeight,
    displayColor: SPATIAL.BOX_COLOR,
  };
}