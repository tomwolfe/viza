'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import type { VizaErrorCode } from '@/types/worker';
import { logger } from '@/config';

export interface UseUserMediaOptions {
  facingMode?: 'user' | 'environment';
  width?: number;
  height?: number;
  isActive?: boolean;
}

export interface CameraError {
  code: VizaErrorCode;
  message: string;
}

export interface UseUserMediaResult {
  videoElement: HTMLVideoElement | null;
  stream: MediaStream | null;
  status: 'idle' | 'requesting' | 'active' | 'error';
  error: CameraError | null;
  retryCount: number;
  start: () => Promise<boolean>;
  stop: () => void;
  resetError: () => void;
}

export function useUserMedia({
  facingMode = 'environment',
  width = 1920,
  height = 1080,
  isActive = false,
}: UseUserMediaOptions = {}): UseUserMediaResult {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'active' | 'error'>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  const mapMediaError = (err: Error): CameraError => {
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
  };

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
    setVideoElement(null);
    setStream(null);
    setStatus('idle');
  }, [videoElement]);

  const resetError = useCallback(() => {
    setError(null);
    setRetryCount(0);
  }, []);

  const startSingleAttempt = useCallback(async (): Promise<boolean> => {
    if (cancelledRef.current) return false;

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: width },
          height: { ideal: height },
        },
        audio: false,
      });

      if (cancelledRef.current) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return false;
      }

      const video = document.createElement('video');
      video.srcObject = mediaStream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;

      await video.play();

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setVideoElement(video);
      setStatus('active');
      setError(null);

      return true;
    } catch (err) {
      throw err;
    }
  }, [facingMode, width, height]);

  const start = useCallback(async (): Promise<boolean> => {
    setStatus('requesting');
    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (cancelledRef.current) return false;
      
      setRetryCount(attempt + 1);
      try {
        const success = await startSingleAttempt();
        if (success) return true;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries - 1 && !cancelledRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    if (!cancelledRef.current) {
      if (lastError) {
        logger.error('[useUserMedia] Camera initialization failed:', lastError.message);
        setError(mapMediaError(lastError));
      } else {
        setError({
          code: 'CAMERA_XR_UNAVAILABLE',
          message: 'Failed to initialize camera after multiple attempts.',
        });
      }
      setStatus('error');
    }
    return false;
  }, [startSingleAttempt]);

  useEffect(() => {
    cancelledRef.current = false;
    if (isActive && status === 'idle') {
      start();
    } else if (!isActive && status !== 'idle') {
      stop();
    }
    
    return () => {
      cancelledRef.current = true;
      stop();
    };
  }, [isActive, status, start, stop]);

  return {
    videoElement,
    stream,
    status,
    error,
    retryCount,
    start,
    stop,
    resetError,
  };
}
