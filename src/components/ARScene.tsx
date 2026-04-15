'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { CameraFallback, useFrameCapture } from './CameraFallback';
import { DetectedObject3D } from './DetectedObject3D';
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
  const [lastInferenceTime, setLastInferenceTime] = useState(0);
  const isProcessingRef = useRef(false);
  const lastVoiceCommandRef = useRef<string | null>(null);

  const handleFrameReady = useCallback((video: HTMLVideoElement) => {
    videoRef.current = video;
  }, []);

  const executeInference = useCallback(async (prompt: string) => {
    if (!videoRef.current || isProcessingRef.current) return;

    isProcessingRef.current = true;

    try {
      const frame = await captureFrame(videoRef.current);
      if (!frame) return;

      const result = await runInference(frame, prompt);
      if (result?.objects && result.objects.length > 0) {
        onObjectsDetected(result.objects);
      }
    } catch (error) {
      console.error('[ARScene] Inference error:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [runInference, captureFrame, onObjectsDetected]);

  useEffect(() => {
    if (voiceCommand && voiceCommand !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommand;
      executeInference(voiceCommand);
    }
  }, [voiceCommand, isModelReady, executeInference]);

  useFrame((state) => {
    if (!isARActive || !isModelReady || !videoRef.current) return;

    const now = state.clock.elapsedTime * 1000;

    if (isProcessingRef.current || now - lastInferenceTime < CONFIG.INFERENCE_INTERVAL) {
      return;
    }

    isProcessingRef.current = true;
    setLastInferenceTime(now);

    const runAutoInference = async () => {
      try {
        const frame = await captureFrame(videoRef.current);
        if (!frame) {
          isProcessingRef.current = false;
          return;
        }

        const result = await runInference(frame, 'Identify objects in this scene.');

        if (result?.objects && result.objects.length > 0) {
          onObjectsDetected(result.objects);
        }
      } catch (error) {
        console.error('[ARScene] Inference error:', error);
      } finally {
        isProcessingRef.current = false;
      }
    };

    runAutoInference();
  });

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

/**
 * Static placeholder AR scene (before AI kicks in).
 */
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
