'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

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
  const sessionRef = useRef<XRSession | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!navigator.xr) {
      setIsSupported(false);
      return;
    }

    navigator.xr.isSessionSupported(sessionMode).then((supported) => {
      setIsSupported(supported);
    });
  }, [sessionMode]);

  const endSession = useCallback(async () => {
    if (sessionRef.current) {
      try {
        await sessionRef.current.end();
      } catch {
        // Session may have already ended
      }
      sessionRef.current = null;
      setSession(null);
      setIsActive(false);
    }
  }, []);

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

      xrSession.addEventListener('end', () => {
        sessionRef.current = null;
        setSession(null);
        setIsActive(false);
      });

      return true;
    } catch {
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
    startSession,
    endSession,
  };
}