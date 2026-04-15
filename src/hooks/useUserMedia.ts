'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

export interface UseUserMediaOptions {
  facingMode?: 'user' | 'environment';
  width?: number;
  height?: number;
}

export interface UseUserMediaResult {
  videoElement: HTMLVideoElement | null;
  stream: MediaStream | null;
  isActive: boolean;
  error: Error | null;
  start: () => Promise<boolean>;
  stop: () => void;
}

export function useUserMedia({
  facingMode = 'environment',
  width = 1920,
  height = 1080,
}: UseUserMediaOptions = {}): UseUserMediaResult {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setVideoElement(null);
    setStream(null);
    setIsActive(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (cancelledRef.current) return false;

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
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
      setIsActive(true);
      setError(null);

      return true;
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      return false;
    }
  }, [facingMode, width, height]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      stop();
    };
  }, [stop]);

  return {
    videoElement,
    stream,
    isActive,
    error,
    start,
    stop,
  };
}