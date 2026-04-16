'use client';

import { memo, useMemo, useEffect } from 'react';
import * as THREE from 'three';

const PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);

interface BoundingBoxProps {
  width: number;
  height: number;
  color: string;
  opacity?: number;
}

export const BoundingBox = memo(function BoundingBox({ width, height, color, opacity = 0.15 }: BoundingBoxProps) {
  const boxWidth = Math.max(width, 0.1);
  const boxHeight = Math.max(height, 0.1);
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