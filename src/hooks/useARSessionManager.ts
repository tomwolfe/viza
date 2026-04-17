'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebXR } from '@/hooks/useWebXR';
import type { VizaErrorCode } from '@/types/worker';
import { logger } from '@/config';

export interface UseARSessionManagerResult {
  isARActive: boolean;
  isXRMode: boolean;
  xrSession: XRSession | null;
  error: string | null;
  errorCode: VizaErrorCode | null;
  startAR: () => Promise<void>;
  stopAR: () => Promise<void>;
}

export function useARSessionManager(): UseARSessionManagerResult {
  const [isARActive, setIsARActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VizaErrorCode | null>(null);

  const webXR = useWebXR();
  const initModelRef = useRef<(() => void) | null>(null);

  const startAR = useCallback(async () => {
    try {
      if (initModelRef.current) {
        initModelRef.current();
      }

      if (webXR.isSupported) {
        const xrSuccess = await webXR.startSession();
        if (xrSuccess) {
          setIsARActive(true);
          setError(null);
          setErrorCode(null);
          return;
        }
      }

      setIsARActive(true);
      setError(null);
      setErrorCode(null);
    } catch (err) {
      logger.error('[ARSession] Failed to start AR:', err);
      setError('Failed to start AR session. Please refresh and try again.');
      setErrorCode('CAMERA_XR_UNAVAILABLE');
    }
  }, [webXR]);

  const stopAR = useCallback(async () => {
    if (webXR.isActive) {
      await webXR.endSession();
    }
    setIsARActive(false);
  }, [webXR]);

  useEffect(() => {
    if (webXR.error) {
      setErrorCode(webXR.error);
      setError(webXR.errorMessage);
    }
  }, [webXR.error, webXR.errorMessage]);

  return {
    isARActive,
    isXRMode: webXR.isActive,
    xrSession: webXR.session,
    error,
    errorCode,
    startAR,
    stopAR,
  };
}

export function setInitModelCallback(cb: () => void): void {
}