'use client';

import { useState, useCallback } from 'react';
import { useUserMedia, type UseUserMediaResult } from './useUserMedia';
import { useWebXR, type UseWebXRResult } from './useWebXR';
import type { VizaErrorCode } from '@/types/worker';

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'error';

export interface CameraError {
  code: VizaErrorCode;
  message: string;
}

export interface UseCameraOptions {
  facingMode?: 'user' | 'environment';
  width?: number;
  height?: number;
  isActive: boolean;
}

export interface UseCameraResult {
  videoElement: HTMLVideoElement | null;
  stream: MediaStream | null;
  status: CameraStatus;
  error: CameraError | null;
  isXRMode: boolean;
  xrSession: XRSession | null;
  startXRSession: () => Promise<boolean>;
  retryCount: number;
  resetError: () => void;
}

function mapMediaToError(err: Error): CameraError {
  const domErr = err as unknown as DOMException;
  if (domErr.name === 'NotAllowedError') {
    return {
      code: 'CAMERA_NOT_ALLOWED',
      message: 'Camera access denied. Please allow camera permissions in your browser settings.',
    };
  }
  if (domErr.name === 'NotFoundError') {
    return {
      code: 'CAMERA_NOT_FOUND',
      message: 'No camera found. Please connect a camera and try again.',
    };
  }
  return {
    code: 'CAMERA_XR_UNAVAILABLE',
    message: err.message || 'Unknown camera error',
  };
}

export function useCamera({
  facingMode = 'environment',
  width = 1920,
  height = 1080,
  isActive,
}: UseCameraOptions): UseCameraResult {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [isXRMode, setIsXRMode] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const attemptRef = { current: 0 };

  const userMedia = useUserMedia({ facingMode, width, height });
  const webXR = useWebXR();

  const resetError = useCallback(() => {
    setError(null);
    setRetryCount(0);
    attemptRef.current = 0;
  }, []);

  const startXRSession = useCallback(async (): Promise<boolean> => {
    const success = await webXR.startSession();
    if (success) {
      setIsXRMode(true);
      setStatus('active');
    }
    return success;
  }, [webXR]);

  const startCamera = useCallback(async () => {
    setStatus('requesting');

    if (webXR.isSupported) {
      const xrSuccess = await webXR.startSession();
      if (xrSuccess) {
        setIsXRMode(true);
        setStatus('active');
        return;
      }
    }

    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      attemptRef.current = attempt + 1;
      setRetryCount(attempt + 1);

      const success = await userMedia.start();
      if (success) {
        setStatus('active');
        return;
      }

      lastError = userMedia.error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }

    if (lastError) {
      setError(mapMediaToError(lastError));
    } else {
      setError({
        code: 'CAMERA_XR_UNAVAILABLE',
        message: 'Failed to initialize camera after multiple attempts.',
      });
    }
    setStatus('error');
  }, [webXR, userMedia]);

  const stopCamera = useCallback(() => {
    userMedia.stop();
    webXR.endSession();
    setStatus('idle');
    setIsXRMode(false);
  }, [userMedia, webXR]);

  return {
    videoElement: userMedia.videoElement,
    stream: userMedia.stream,
    status,
    error,
    isXRMode,
    xrSession: webXR.session,
    startXRSession,
    retryCount,
    resetError,
  };
}