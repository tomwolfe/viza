'use client';

import { useState, useCallback, useEffect } from 'react';
import { useUserMedia } from './useUserMedia';
import type { VizaErrorCode } from '@/types/worker';
import { logger } from '@/config';

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
  const [retryCount, setRetryCount] = useState(0);

  const userMedia = useUserMedia({ facingMode, width, height });

  const resetError = useCallback(() => {
    setError(null);
    setRetryCount(0);
  }, []);

  const startCamera = useCallback(async () => {
    setStatus('requesting');

    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      setRetryCount(attempt + 1);

      const success = await userMedia.start();
      if (success) {
        setStatus('active');
        return;
      }

      lastError = userMedia.error;
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    if (lastError) {
      logger.error('[useCamera] Camera initialization failed:', lastError.message);
      setError(mapMediaToError(lastError));
    } else {
      logger.error('[useCamera] Camera initialization failed after retries');
      setError({
        code: 'CAMERA_XR_UNAVAILABLE',
        message: 'Failed to initialize camera after multiple attempts.',
      });
    }
    setStatus('error');
  }, [userMedia]);

  const stopCamera = useCallback(() => {
    userMedia.stop();
    setStatus('idle');
  }, [userMedia]);

  useEffect(() => {
    if (isActive && status === 'idle') {
      startCamera();
    } else if (!isActive && status !== 'idle') {
      stopCamera();
    }
  }, [isActive, status, startCamera, stopCamera]);

  return {
    videoElement: userMedia.videoElement,
    stream: userMedia.stream,
    status,
    error,
    retryCount,
    resetError,
  };
}
