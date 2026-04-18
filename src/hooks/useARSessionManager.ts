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

  const webXR = useWebXR();
  const initModelRef = useRef<(() => void) | null>(null);

  const errorRef = useRef<string | null>(null);
  const errorCodeRef = useRef<VizaErrorCode | null>(null);

  const startAR = useCallback(async () => {
    try {
      if (initModelRef.current) {
        initModelRef.current();
      }

      if (webXR.isSupported) {
        const xrSuccess = await webXR.startSession();
        if (xrSuccess) {
          setIsARActive(true);
          errorRef.current = null;
          errorCodeRef.current = null;
          return;
        }
      }

      setIsARActive(true);
      errorRef.current = null;
      errorCodeRef.current = null;
    } catch (err) {
      logger.error('[ARSession] Failed to start AR:', err);
      errorRef.current = 'Failed to start AR session. Please refresh and try again.';
      errorCodeRef.current = 'CAMERA_XR_UNAVAILABLE';
    }
  }, [webXR]);

  const stopAR = useCallback(async () => {
    if (webXR.isActive) {
      await webXR.endSession();
    }
    setIsARActive(false);
  }, [webXR]);

  return {
    isARActive,
    isXRMode: webXR.isActive,
    xrSession: webXR.session,
    error: errorRef.current,
    errorCode: errorCodeRef.current,
    startAR,
    stopAR,
  };
}