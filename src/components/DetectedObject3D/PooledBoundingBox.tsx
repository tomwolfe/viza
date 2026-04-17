'use client';

import { memo, useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { CONFIG } from '@/config';
import type { DetectedObject } from '@/schemas/vision';

interface PooledBoundingBoxesProps {
  objects: DetectedObject[];
  boxSizes: Array<{ width: number; height: number }>;
  positions: THREE.Matrix4[];
  color: string;
  opacity?: number;
}

export const PooledBoundingBoxes = memo(function PooledBoundingBoxes({
  objects,
  boxSizes,
  positions,
  color,
  opacity = CONFIG.SPATIAL.BOX_OPACITY,
}: PooledBoundingBoxesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [color, opacity]
  );

  const lineMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color, linewidth: 1 }),
    [color]
  );

  useEffect(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;
    const tempMatrix = new THREE.Matrix4();
    const tempPosition = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();

    boxSizes.forEach((size, i) => {
      const boxWidth = Math.max(size.width, CONFIG.SPATIAL.MIN_BOX_SIZE);
      const boxHeight = Math.max(size.height, CONFIG.SPATIAL.MIN_BOX_SIZE);

      tempPosition.set(0, 0, 0);
      tempQuaternion.identity();
      tempScale.set(boxWidth, boxHeight, 1);

      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [boxSizes]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      lineMaterial.dispose();
    };
  }, [geometry, material, lineMaterial]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, objects.length]}
      frustumCulled={false}
    />
  );
});

export function shouldUsePooling(objectCount: number): boolean {
  return objectCount > 20;
}