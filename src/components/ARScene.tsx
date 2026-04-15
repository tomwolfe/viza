'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { CameraFallback, useFrameCapture } from './CameraFallback';
import type { DetectedObject } from '@/hooks/useWebLLM';

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

  // Expose trigger method via window global (for voice integration)
  useEffect(() => {
    const triggerFn = triggerVoiceInference;
    window.__arSceneTriggerInference = triggerFn;
    return () => {
      delete window.__arSceneTriggerInference;
    };
  }, [triggerVoiceInference]);

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
 * Renders a single detected object as a 3D overlay.
 * Shows bounding box and label.
 */
function DetectedObject3D({ obj, index }: { obj: DetectedObject; index: number }) {
  const [x, y, width, height] = obj.bbox_2d;

  // Map 2D coordinates to 3D world space
  // Simple mapping: center of screen is [0, 0], edges are [-2, 2] range
  const worldX = ((x + width / 2) / 512 - 0.5) * 4;
  const worldY = -((y + height / 2) / 512 - 0.5) * 3;
  const worldZ = -3 - index * 0.5; // Stack slightly back

  const boxWidth = (width / 512) * 4;
  const boxHeight = (height / 512) * 3;

  // Memoize geometry and material to avoid recreating on each render
  const planeGeom = useMemo(() => new THREE.PlaneGeometry(boxWidth, boxHeight), [boxWidth, boxHeight]);
  const edgeGeom = useMemo(() => new THREE.EdgesGeometry(planeGeom), [planeGeom]);

  return (
    <group position={[worldX, worldY, worldZ]}>
      {/* Glowing Bounding Box */}
      <mesh>
        <primitive object={planeGeom} attach="geometry" />
        <meshBasicMaterial
          color="#00ff88"
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Edges */}
      <lineSegments>
        <primitive object={edgeGeom} attach="geometry" />
        <lineBasicMaterial color="#00ff88" linewidth={2} />
      </lineSegments>

      {/* Label Background */}
      <mesh position={[0, -boxHeight / 2 - 0.15, 0.01]}>
        <planeGeometry args={[Math.max(boxWidth * 0.9, 0.5), 0.25]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.7} />
      </mesh>

      {/* Object Name Label */}
      <Text
        position={[0, -boxHeight / 2 - 0.15, 0.02]}
        fontSize={0.12}
        color="#00ff88"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {obj.name}
      </Text>

      {/* Action Text (smaller, below name) */}
      {obj.action && (
        <Text
          position={[0, -boxHeight / 2 - 0.3, 0.02]}
          fontSize={0.08}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.01}
          outlineColor="#000000"
        >
          {obj.action}
        </Text>
      )}
    </group>
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
