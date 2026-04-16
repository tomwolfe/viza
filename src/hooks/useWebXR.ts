'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import type { VizaErrorCode } from '@/types/worker';
import { logger } from '@/config';

export interface UseWebXROptions {
  sessionMode?: 'immersive-ar' | 'immersive-vr';
  requiredFeatures?: string[];
  optionalFeatures?: string[];
}

export interface UseWebXRResult {
  isSupported: boolean;
  isActive: boolean;
  session: XRSession | null;
  hasCameraAccess: boolean;
  error: VizaErrorCode | null;
  errorMessage: string | null;
  startSession: () => Promise<boolean>;
  endSession: () => Promise<void>;
}

export function useWebXR({
  sessionMode = 'immersive-ar',
  requiredFeatures = ['hit-test'],
  optionalFeatures = ['camera-access', 'local-floor'],
}: UseWebXROptions = {}): UseWebXRResult {
  const [isSupported, setIsSupported] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [session, setSession] = useState<XRSession | null>(null);
  const [hasCameraAccess, setHasCameraAccess] = useState(false);
  const [error, setError] = useState<VizaErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const cancelledRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!navigator.xr) {
      return;
    }

    navigator.xr.isSessionSupported(sessionMode).then((supported) => {
      if (isMountedRef.current) {
        setIsSupported(supported);
      }
    });
  }, [sessionMode]);

  const endSession = useCallback(async () => {
    if (sessionRef.current) {
      try {
        await sessionRef.current.end();
      } catch (e) {
        logger.debug('[WebXR] End session error (likely already ended):', e);
      }
      sessionRef.current = null;
      setSession(null);
      setIsActive(false);
    }
  }, []);

  const mapXRError = (err: unknown): VizaErrorCode => {
    const domErr = err as DOMException;
    if (domErr.name === 'NotAllowedError') return 'CAMERA_NOT_ALLOWED';
    if (domErr.name === 'NotSupportedError') return 'CAMERA_XR_UNAVAILABLE';
    return 'CAMERA_XR_UNAVAILABLE';
  };

  const startSession = useCallback(async (): Promise<boolean> => {
    if (!navigator.xr || cancelledRef.current) return false;

    try {
      const xrSession = await navigator.xr.requestSession(sessionMode, {
        requiredFeatures,
        optionalFeatures,
      });

      if (cancelledRef.current) {
        await xrSession.end();
        return false;
      }

      const hasCamera = xrSession.enabledFeatures?.includes('camera-access');

      sessionRef.current = xrSession;
      setSession(xrSession);
      setIsActive(true);
      setHasCameraAccess(!!hasCamera);
      setError(null);
      setErrorMessage(null);

      xrSession.addEventListener('end', () => {
        sessionRef.current = null;
        setSession(null);
        setIsActive(false);
      });

      return true;
    } catch (err) {
      const code = mapXRError(err);
      setError(code);
      setErrorMessage((err as Error).message || 'Failed to start XR session');
      return false;
    }
  }, [sessionMode, requiredFeatures, optionalFeatures]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (sessionRef.current) {
        sessionRef.current.end();
      }
    };
  }, []);

  return {
    isSupported,
    isActive,
    session,
    hasCameraAccess,
    error,
    errorMessage,
    startSession,
    endSession,
  };
}