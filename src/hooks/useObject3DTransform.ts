'use client';

import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMemo } from 'react';
import type { DetectedObject } from '@/schemas/vision';
import { SpatialEngine } from '@/utils/spatial';
import { CONFIG } from '@/config';

interface UseObject3DTransformOptions {
  obj: DetectedObject;
  index: number;
  position?: THREE.Vector3;
}

export function useObject3DTransform({ obj, index, position: _position }: UseObject3DTransformOptions) {
  const { camera, viewport } = useThree();
  const [x, y, width, height] = obj.bbox_2d;

  const { SPATIAL } = CONFIG;
  const targetSize = SPATIAL.TARGET_SIZE;
  const worldDepth = SPATIAL.DEFAULT_DEPTH - index * SPATIAL.DEPTH_INCREMENT;

  const cameraPerspective = camera as THREE.PerspectiveCamera;

  const size = useMemo(
    () =>
      SpatialEngine.projectBoundingBoxSize({
        width,
        height,
        targetSize,
        depth: worldDepth,
        fov: cameraPerspective.fov,
        aspect: viewport.aspect,
      }),
    [width, height, cameraPerspective.fov, viewport.aspect, worldDepth, targetSize]
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
    boxWidth,
    boxHeight,
    displayColor: SPATIAL.BOX_COLOR,
  };
}