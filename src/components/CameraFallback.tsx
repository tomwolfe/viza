'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * CameraFallback component.
 * 
 * Attempts WebXR Immersive AR with camera-access first.
 * Falls back to getUserMedia "Magic Window" mode if unavailable.
 * Renders the camera feed as a fullscreen background plane.
 */

// Scale for the background plane (large enough to fill FOV)
const PLANE_SCALE = [20, 10, 1] as const;

interface CameraFallbackProps {
  isActive: boolean;
  onFrameReady?: (video: HTMLVideoElement) => void;
}

export function CameraFallback({ isActive, onFrameReady }: CameraFallbackProps) {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Attempt 1: WebXR Immersive AR with camera-access
   */
  const requestWebXR = useCallback(async (): Promise<boolean> => {
    if (!navigator.xr) return false;

    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) return false;

      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['camera-access', 'local-floor'],
      });

      // Check if camera-access was granted
      const hasCamera = session.enabledFeatures?.includes('camera-access');
      if (!hasCamera) {
        await session.end();
        return false;
      }

      // WebXR session active — R3F XR will handle rendering
      return true;
    } catch (err) {
      console.warn('[CameraFallback] WebXR request failed:', err);
      return false;
    }
  }, []);

  /**
   * Attempt 2: getUserMedia fallback (Magic Window)
   * Renders video to a fullscreen background plane.
   */
  const requestUserMedia = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Prefer rear camera on mobile
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      // Create video element
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.setAttribute('playsinline', 'playsinline');

      await video.play();

      streamRef.current = stream;
      setVideoElement(video);
      setStreamActive(true);
      setError(null);

      // Notify parent that frame is ready for AI capture
      onFrameReady?.(video);

      return true;
    } catch (err) {
      console.error('[CameraFallback] getUserMedia failed:', err);
      setError('Camera access denied. Please allow camera permissions.');
      return false;
    }
  }, [onFrameReady]);

  /**
   * Initialize camera on mount or when isActive changes.
   */
  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    const initCamera = async () => {
      // Attempt WebXR first
      const xrSuccess = await requestWebXR();
      if (xrSuccess && !cancelled) {
        console.log('[CameraFallback] WebXR session started');
        return;
      }

      // Fallback to getUserMedia
      if (!cancelled) {
        console.log('[CameraFallback] Falling back to getUserMedia');
        await requestUserMedia();
      }
    };

    initCamera();

    // Cleanup on unmount
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      setVideoElement(null);
      setStreamActive(false);
    };
  }, [isActive, requestWebXR, requestUserMedia]);

  if (!isActive) return null;

  return (
    <>
      {/* Background Camera Plane */}
      {streamActive && videoElement && (
        <VideoPlane
          video={videoElement}
        />
      )}

      {/* Error Overlay */}
      {error && (
        <mesh position={[0, 0, -2]}>
          <planeGeometry args={[2, 0.3]} />
          <meshBasicMaterial color="red" transparent opacity={0.7} />
        </mesh>
      )}
    </>
  );
}

/**
 * VideoPlane component.
 * Renders a video element as a fullscreen background plane.
 */
interface VideoPlaneProps {
  video: HTMLVideoElement;
}

function VideoPlane({ video }: VideoPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Create video texture - memoized per video
  const texture = useMemo(() => {
    const newTexture = new THREE.VideoTexture(video);
    newTexture.minFilter = THREE.LinearFilter;
    newTexture.magFilter = THREE.LinearFilter;
    newTexture.format = THREE.RGBAFormat;
    newTexture.colorSpace = THREE.SRGBColorSpace;
    return newTexture;
  }, [video]);

  // Update texture every frame
  useFrame(() => {
    texture.updateMatrix(); // Force render update
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -5]} scale={PLANE_SCALE as unknown as [number, number, number]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Hook to capture frames from a video element.
 * Returns a function to grab the current frame as ImageBitmap.
 */
export function useFrameCapture() {
  const captureFrame = useCallback(async (video: HTMLVideoElement | null): Promise<ImageBitmap | null> => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    // Create offscreen canvas for frame capture
    const canvas = document.createElement('canvas');
    const targetSize = 512;
    canvas.width = targetSize;
    canvas.height = targetSize;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Center crop to square
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;

    ctx.drawImage(video, sx, sy, size, size, 0, 0, targetSize, targetSize);

    // transferToImageBitmap is available in modern browsers
    const bitmap = (canvas as unknown as { transferToImageBitmap: () => ImageBitmap }).transferToImageBitmap?.();
    if (bitmap) return bitmap;

    // Fallback: create ImageBitmap from canvas
    return createImageBitmap(canvas);
  }, []);

  return { captureFrame };
}
