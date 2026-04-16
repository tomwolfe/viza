'use client';

import { memo, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { CONFIG } from '@/config';

const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);

interface BoundingBoxProps {
  width: number;
  height: number;
  color: string;
  opacity?: number;
}

export const BoundingBox = memo(function BoundingBox({ width, height, color, opacity = CONFIG.SPATIAL.BOX_OPACITY }: BoundingBoxProps) {
  const boxWidth = Math.max(width, CONFIG.SPATIAL.MIN_BOX_SIZE);
  const boxHeight = Math.max(height, CONFIG.SPATIAL.MIN_BOX_SIZE);
  const boxScale: [number, number, number] = [boxWidth, boxHeight, 1];

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
    () => new THREE.LineBasicMaterial({ color, linewidth: 2 }),
    [color]
  );

  const edgesGeometry = useMemo(
    () => new THREE.EdgesGeometry(PLANE_GEOMETRY),
    []
  );

  useEffect(() => {
    return () => {
      material.dispose();
      lineMaterial.dispose();
      edgesGeometry.dispose();
    };
  }, [material, lineMaterial, edgesGeometry]);

  return (
    <group>
      <mesh scale={boxScale}>
        <planeGeometry args={[1, 1]} />
        <primitive object={material} attach="material" />
      </mesh>

      <lineSegments scale={boxScale}>
        <primitive object={edgesGeometry} attach="geometry" />
        <primitive object={lineMaterial} attach="material" />
      </lineSegments>
    </group>
  );
});