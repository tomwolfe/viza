'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { captureVideoFrame } from '@/utils/frameCapture';
import { useCamera } from '@/hooks/useCamera';

interface CameraFallbackProps {
  isActive: boolean;
  onFrameReady?: (video: HTMLVideoElement) => void;
}

export function CameraFallback({ isActive, onFrameReady }: CameraFallbackProps) {
  const { videoElement, streamActive, error, isXRMode } = useCamera({
    isActive,
    onFrameReady,
  });

  const errorMessage = error?.message ?? null;

  if (!isActive) return null;

  return (
    <>
      {streamActive && videoElement && !isXRMode && (
        <VideoPlane video={videoElement} />
      )}

      {errorMessage && (
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[2, 0.3]} />
          <meshBasicMaterial color="red" transparent opacity={0.7} />
        </mesh>
      )}
    </>
  );
}

interface VideoPlaneProps {
  video: HTMLVideoElement;
}

function VideoPlane({ video }: VideoPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { viewport } = useThree();

  const texture = useMemo(() => {
    const newTexture = new THREE.VideoTexture(video);
    newTexture.minFilter = THREE.LinearFilter;
    newTexture.magFilter = THREE.LinearFilter;
    newTexture.format = THREE.RGBAFormat;
    newTexture.colorSpace = THREE.SRGBColorSpace;
    return newTexture;
  }, [video]);

  const planeScale: [number, number, number] = useMemo(() => {
    return [viewport.width, viewport.height, 1];
  }, [viewport.width, viewport.height]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  useFrame(() => {
    texture.updateMatrix();
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -5]} scale={planeScale}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function useFrameCapture() {
  const captureFrame = async (video: HTMLVideoElement | null): Promise<ImageBitmap | null> => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    return captureVideoFrame(video);
  };

  return { captureFrame };
}
