'use client';

import { useState, useCallback, useRef } from 'react';
import { useWebXR } from '@/hooks/useWebXR';
import { useVizaError } from '@/contexts/VizaErrorContext';
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
  const { setError: setVizaError, clearError: clearVizaError } = useVizaError();

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
          console.trace('[Viza:DEBUG] Setting isARActive=true (XR session started)');
          setIsARActive(true);
          clearVizaError();
          return;
        }
      }

      console.trace('[Viza:DEBUG] Setting isARActive=true (fallback)');
      setIsARActive(true);
      clearVizaError();
    } catch (err) {
      logger.error('[ARSession] Failed to start AR:', err);
      setVizaError('CAMERA_XR_UNAVAILABLE', 'Failed to start AR session. Please refresh and try again.');
    }
  }, [webXR, setVizaError, clearVizaError]);

  const stopAR = useCallback(async () => {
    if (webXR.isActive) {
      await webXR.endSession();
    }
    console.trace('[Viza:DEBUG] Setting isARActive=false');
    setIsARActive(false);
  }, [webXR]);

  return {
    isARActive,
    isXRMode: webXR.isActive,
    xrSession: webXR.session,
    error: null,
    errorCode: null,
    startAR,
    stopAR,
  };
}
