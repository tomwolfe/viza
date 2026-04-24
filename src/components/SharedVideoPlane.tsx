'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface SharedVideoPlaneProps {
  video: HTMLVideoElement;
}

export function SharedVideoPlane({ video }: SharedVideoPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { viewport, camera } = useThree();
  const texture = useMemo(() => {
    const newTexture = new THREE.VideoTexture(video);
    newTexture.generateMipmaps = false;
    newTexture.minFilter = THREE.LinearFilter;
    newTexture.magFilter = THREE.LinearFilter;
    newTexture.format = THREE.RGBAFormat;
    newTexture.colorSpace = THREE.SRGBColorSpace;
    return newTexture;
  }, [video]);

  const planeScale: [number, number, number] = useMemo(() => {
    const vp = viewport.getCurrentViewport(camera, new THREE.Vector3(0, 0, -5));
    return [vp.width, vp.height, 1];
  }, [viewport, camera]);

  useFrame(() => {
    if (video.readyState >= 2) {
      texture.needsUpdate = true;
    }
  });

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <mesh ref={meshRef} position={[0, 0, -5]} scale={planeScale}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}