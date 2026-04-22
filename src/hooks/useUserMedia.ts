'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import type { VizaErrorCode } from '@/types/worker';
import { parseSystemError } from '@/utils/errorUtils';
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'active' | 'error'>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      document.body.removeChild(videoRef.current);
      videoRef.current = null;
    }
    setVideoElement(null);
    setStream(null);
    setStatus('idle');
  }, []);

  const resetError = useCallback(() => {
    setError(null);
    setRetryCount(0);
  }, []);

  const startSingleAttempt = useCallback(async (): Promise<boolean> => {
    if (cancelledRef.current) return false;
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

      let video = videoRef.current;
      if (!video) {
        video = document.createElement('video');
        video.className = 'viza-video-elt';
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('muted', '');
        video.style.setProperty('position', 'fixed');
        video.style.setProperty('left', '-9999px');
        video.style.setProperty('top', '-9999px');
        video.style.setProperty('width', '1px');
        video.style.setProperty('height', '1px');
        document.body.appendChild(video);
        videoRef.current = video;
      }

      video.srcObject = mediaStream;

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setVideoElement(video);
      setStatus('active');
      setError(null);

      return true;
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
        setError(parseSystemError(lastError, 'media') as CameraError);
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
