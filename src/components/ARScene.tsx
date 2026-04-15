'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { CameraFallback, useFrameCapture } from './CameraFallback';
import { DetectedObject3D } from './DetectedObject3D';
import type { DetectedObject } from '@/hooks/useWebLLM';
import { useARStore } from '@/store/useARStore';

// Create XR store
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
}

/**
 * Main AR Scene component.
 * Handles WebXR session, camera fallback, and AI inference loop.
 */
export function ARScene({
  isARActive,
  isModelReady,
  runInference,
  detectedObjects,
  onObjectsDetected,
}: ARSceneProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { captureFrame } = useFrameCapture();
  const [lastInferenceTime, setLastInferenceTime] = useState(0);
  const inferenceInterval = 5000; // 5 seconds between inferences
  const isProcessingRef = useRef(false);

  /**
   * Called when camera video element is ready.
   */
  const handleFrameReady = useCallback((video: HTMLVideoElement) => {
    videoRef.current = video;
  }, []);

  /**
   * AI inference loop - runs every 5 seconds on the current frame.
   */
  useFrame((state) => {
    if (!isARActive || !isModelReady || !videoRef.current) return;

    const now = state.clock.elapsedTime * 1000;

    // Skip if we're already processing or it's too soon
    if (isProcessingRef.current || now - lastInferenceTime < inferenceInterval) {
      return;
    }

    // Trigger inference
    isProcessingRef.current = true;
    setLastInferenceTime(now);

    const runInferenceAsync = async () => {
      try {
        // Capture current video frame (downsamples to 512x512)
        const frame = await captureFrame(videoRef.current);
        if (!frame) {
          isProcessingRef.current = false;
          return;
        }

        // Run AI inference
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

    runInferenceAsync();
  });

/**
    * Handle voice-triggered inference.
    * Called when user speaks a command.
    */
  const triggerVoiceInference = useCallback(async (voicePrompt: string) => {
    if (!isModelReady || !videoRef.current) return;

    if (isProcessingRef.current) {
      console.warn('[ARScene] Already processing, skipping');
      return;
    }

    isProcessingRef.current = true;

    try {
      const frame = await captureFrame(videoRef.current);
      if (!frame) return;

      const result = await runInference(frame, voicePrompt);
      if (result?.objects && result.objects.length > 0) {
        onObjectsDetected(result.objects);
      }
    } catch (error) {
      console.error('[ARScene] Voice inference error:', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [isModelReady, runInference, captureFrame, onObjectsDetected]);

  // Subscribe to voice transcript from store (for R3F useFrame loop)
  const voiceTranscript = useARStore((state) => state.voiceTranscript);
  const setVoiceTranscript = useARStore((state) => state.setVoiceTranscript);

  // Check for new voice transcripts and trigger inference
  useEffect(() => {
    if (voiceTranscript && isModelReady) {
      triggerVoiceInference(voiceTranscript).then(() => {
        setVoiceTranscript(null);
      });
    }
  }, [voiceTranscript, isModelReady, triggerVoiceInference, setVoiceTranscript]);

  if (!isARActive) return null;

  return (
    <XR store={xrStore}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />

      {/* Camera Fallback Plane - rendered behind everything */}
      <CameraFallback isActive={isARActive} onFrameReady={handleFrameReady} />

      {/* Detected Objects Rendering */}
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
