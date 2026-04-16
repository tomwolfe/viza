'use client';

import { useCamera } from '@/hooks/useCamera';

interface CameraFallbackProps {
  isActive: boolean;
  onFrameReady?: (video: HTMLVideoElement) => void;
}

export function CameraFallback({ isActive, onFrameReady }: CameraFallbackProps) {
  const { videoElement, stream, status, error, isXRMode } = useCamera({
    isActive,
  });

  const errorMessage = error?.message ?? null;

  if (!isActive) return null;

  return (
    <>
      {status === 'active' && videoElement && !isXRMode && (
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[2, 1]} />
          <meshBasicMaterial color="#333333" />
        </mesh>
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
