'use client';

import { useRef, useCallback, useEffect } from 'react';
import { XR, createXRStore } from '@react-three/xr';
import { CameraFallback, useFrameCapture } from './CameraFallback';
import { DetectedObject3D } from './DetectedObject3D';
import { useInferenceLoop } from '@/hooks/useInferenceLoop';
import type { DetectedObject } from '@/schemas/vision';
import { CONFIG } from '@/config';

const xrStore = createXRStore();

interface ARSceneProps {
  isARActive: boolean;
  isModelReady: boolean;
  runInference: (
    image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  detectedObjects: DetectedObject[];
  onObjectsDetected: (objects: DetectedObject[]) => void;
  voiceCommand?: string | null;
}

export function ARScene({
  isARActive,
  isModelReady,
  runInference,
  detectedObjects,
  onObjectsDetected,
  voiceCommand,
}: ARSceneProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { captureFrame } = useFrameCapture();
  const lastVoiceCommandRef = useRef<string | null>(null);

  const handleFrameReady = useCallback((video: HTMLVideoElement) => {
    videoRef.current = video;
  }, []);

  const handleObjectsDetected = useCallback(
    (objects: DetectedObject[]) => {
      onObjectsDetected(objects);
    },
    [onObjectsDetected]
  );

  const { setVideoSource, setActive, executeInference, cancelPending } = useInferenceLoop({
    runInference,
    captureFrame,
    onObjectsDetected: handleObjectsDetected,
    intervalMs: CONFIG.INFERENCE_INTERVAL,
  });

  useEffect(() => {
    setActive(isARActive && isModelReady);
    setVideoSource(videoRef.current);
  }, [isARActive, isModelReady, setActive, setVideoSource]);

  useEffect(() => {
    if (voiceCommand && voiceCommand !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommand;
      cancelPending();
      executeInference(voiceCommand, true);
    }
  }, [voiceCommand, isModelReady, executeInference, cancelPending]);

  if (!isARActive) return null;

  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />

      <CameraFallback isActive={isARActive} onFrameReady={handleFrameReady} />

      {detectedObjects.map((obj, index) => (
        <DetectedObject3D key={`${obj.name}-${index}`} obj={obj} index={index} />
      ))}
    </XR>
  );
}

export function PlaceholderScene() {
  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <mesh position={[0, 0, -3]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="blue" transparent opacity={0.5} />
      </mesh>
    </XR>
  );
}