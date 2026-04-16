'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useFrameCapture } from './CameraFallback';
import { useInferenceLoop } from '@/hooks/useInferenceLoop';
import { CONFIG } from '@/config';
import type { DetectedObject } from '@/schemas/vision';

interface InferenceOrchestratorProps {
  runInference: (
    image: ImageBitmap,
    prompt: string
  ) => Promise<{ objects: DetectedObject[]; rawText?: string } | null>;
  onObjectsDetected: (objects: DetectedObject[]) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  voiceCommand?: string | null;
  isARActive: boolean;
  isModelReady: boolean;
}

export function InferenceOrchestrator({
  runInference,
  onObjectsDetected,
  videoRef,
  voiceCommand,
  isARActive,
  isModelReady,
}: InferenceOrchestratorProps) {
  const { captureFrame } = useFrameCapture();
  const { run, cancelPending, setActive, setVideoSource } = useInferenceLoop({
    runInference,
    captureFrame,
    onObjectsDetected,
    intervalMs: CONFIG.INFERENCE_INTERVAL,
  });

  const lastVoiceCommandRef = useRef<string | null>(null);

  React.useEffect(() => {
    setVideoSource(videoRef.current);
  }, [videoRef, setVideoSource]);

  React.useEffect(() => {
    if (voiceCommand && voiceCommand !== lastVoiceCommandRef.current && isModelReady) {
      lastVoiceCommandRef.current = voiceCommand;
      cancelPending();
      run(voiceCommand, true);
    }
  }, [voiceCommand, isModelReady, run, cancelPending]);

  React.useEffect(() => {
    setActive(isARActive && isModelReady);
  }, [isARActive, isModelReady, setActive]);

  return null;
}