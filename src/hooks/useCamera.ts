'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

export type CameraErrorCode = 'NOT_ALLOWED' | 'NOT_FOUND' | 'XR_UNAVAILABLE' | 'UNKNOWN';

export interface CameraError {
  code: CameraErrorCode;
  message: string;
}

export interface UseCameraOptions {
  facingMode?: 'user' | 'environment';
  width?: number;
  height?: number;
  isActive: boolean;
  onFrameReady?: (video: HTMLVideoElement) => void;
  onXRSessionReady?: (session: XRSession) => void;
}

export interface UseCameraResult {
  videoElement: HTMLVideoElement | null;
  streamActive: boolean;
  error: CameraError | null;
  isXRMode: boolean;
  xrSession: XRSession | null;
  cameraAccessSupported: boolean;
  startXRSession: () => Promise<boolean>;
  retryCount: number;
  resetError: () => void;
}

function mapCameraError(err: unknown): CameraError {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return {
        code: 'NOT_ALLOWED',
        message: 'Camera access denied. Please allow camera permissions in your browser settings.',
      };
    }
    if (err.name === 'NotFoundError') {
      return {
        code: 'NOT_FOUND',
        message: 'No camera found. Please connect a camera and try again.',
      };
    }
  }
  return {
    code: 'UNKNOWN',
    message: `Camera error: ${err instanceof Error ? err.message : 'Unknown error'}`,
  };
}

export function useCamera({
  facingMode = 'environment',
  width = 1920,
  height = 1080,
  isActive,
  onFrameReady,
  onXRSessionReady,
}: UseCameraOptions): UseCameraResult {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [isXRMode, setIsXRMode] = useState(false);
  const [xrSession, setXrSession] = useState<XRSession | null>(null);
  const [cameraAccessSupported, setCameraAccessSupported] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const isActiveRef = useRef(isActive);
  const retryCountRef = useRef(0);
  const [retryCount, setRetryCount] = useState(0);

  const startXRSession = useCallback(async (): Promise<boolean> => {
    if (!navigator.xr) {
      return false;
    }

    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) {
        return false;
      }

      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['camera-access', 'local-floor'],
      });

      const hasCamera = session.enabledFeatures?.includes('camera-access');
      if (!hasCamera) {
        await session.end();
        setCameraAccessSupported(false);
        return false;
      }

      setCameraAccessSupported(true);
      setIsXRMode(true);
      setXrSession(session);
      onXRSessionReady?.(session);

      return true;
    } catch {
      return false;
    }
  }, [onXRSessionReady]);

  const resetError = useCallback(() => {
    setError(null);
    setRetryCount(0);
    retryCountRef.current = 0;
  }, []);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (xrSession) {
      xrSession.end();
      setXrSession(null);
    }
    setVideoElement(null);
    setStreamActive(false);
    setIsXRMode(false);
  }, [xrSession]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    let cancelled = false;

    const requestWebXR = async (): Promise<boolean> => {
      if (!navigator.xr || cancelled) return false;

      try {
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (!supported || cancelled) return false;

        const session = await navigator.xr.requestSession('immersive-ar', {
          requiredFeatures: ['hit-test'],
          optionalFeatures: ['camera-access', 'local-floor'],
        });

        const hasCamera = session.enabledFeatures?.includes('camera-access');
        if (!hasCamera || cancelled) {
          await session.end();
          setCameraAccessSupported(false);
          return false;
        }

        setCameraAccessSupported(true);
        setIsXRMode(true);
        setXrSession(session);
        onXRSessionReady?.(session);
        return true;
      } catch {
        return false;
      }
    };

    const requestUserMedia = async (): Promise<boolean> => {
      if (cancelled) return false;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: width },
            height: { ideal: height },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return false;
        }

        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.setAttribute('playsinline', 'playsinline');

        await video.play();

        streamRef.current = stream;
        setVideoElement(video);
        setStreamActive(true);
        setError(null);
        setIsXRMode(false);

        onFrameReady?.(video);

        return true;
      } catch (err) {
        if (cancelled) return false;
        const cameraError = mapCameraError(err);
        setError(cameraError);
        setStreamActive(false);
        return false;
      }
    };

    const initCamera = async () => {
      if (!isActiveRef.current || cancelled) return;

      const xrSuccess = await requestWebXR();
      if (xrSuccess && !cancelled && isActiveRef.current) {
        return;
      }

      if (!cancelled && isActiveRef.current) {
        let lastError: CameraError | null = null;
        const maxRetries = 3;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const success = await requestUserMedia();
          if (success || cancelled || !isActiveRef.current) {
            return;
          }
          lastError = error;
          retryCountRef.current = attempt + 1;
          setRetryCount(attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }

        if (lastError) {
          setError(lastError);
        }
      }
    };

    initCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isActive, stopStream, facingMode, width, height, onFrameReady, onXRSessionReady]);

  return {
    videoElement,
    streamActive,
    error,
    isXRMode,
    xrSession,
    cameraAccessSupported,
    startXRSession,
    retryCount,
    resetError,
  };
}
