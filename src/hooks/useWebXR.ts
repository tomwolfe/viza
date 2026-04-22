'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { VizaErrorCode } from '@/types/worker';
import { logger } from '@/config';

export interface HitTestResult {
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
}

export interface XRAnchor {
  id: string;
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  timestamp: number;
  isNative?: boolean;
  nativeAnchor?: XRAnchor;
}

export interface UseWebXROptions {
  sessionMode?: 'immersive-ar' | 'immersive-vr';
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  enableAnchors?: boolean;
}

export interface UseWebXRResult {
  isSupported: boolean;
  isActive: boolean;
  session: XRSession | null;
  hasCameraAccess: boolean;
  hasHitTest: boolean;
  hasAnchors: boolean;
  hitTestResult: HitTestResult | null;
  anchors: Map<string, XRAnchor>;
  error: VizaErrorCode | null;
  errorMessage: string | null;
  startSession: () => Promise<boolean>;
  endSession: () => Promise<void>;
  createAnchor: (position: THREE.Vector3, orientation?: THREE.Quaternion) => Promise<XRAnchor | null>;
  getAnchor: (id: string) => XRAnchor | undefined;
  updateAnchor: (id: string, position: THREE.Vector3, orientation?: THREE.Quaternion) => void;
  removeAnchor: (id: string) => void;
}

export function useWebXR({
  sessionMode = 'immersive-ar',
  requiredFeatures = ['hit-test'],
  optionalFeatures = ['camera-access', 'local-floor'],
  enableAnchors = true,
}: UseWebXROptions = {}): UseWebXRResult {
  const [isSupported, setIsSupported] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [session, setSession] = useState<XRSession | null>(null);
  const [hasCameraAccess, setHasCameraAccess] = useState(false);
  const [hasHitTest, setHasHitTest] = useState(false);
  const [hasAnchors, setHasAnchors] = useState(false);
  const [hitTestResult, setHitTestResult] = useState<HitTestResult | null>(null);
  const [anchors, setAnchors] = useState<Map<string, XRAnchor>>(new Map());
  const [error, setError] = useState<VizaErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const hitTestSourceRef = useRef<XRHitTestSource | null>(null);
  const refSpaceRef = useRef<XRReferenceSpace | null>(null);
  const anchorsRef = useRef<Map<string, XRAnchor>>(new Map());
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

  const onSelect = useCallback(() => {
  }, []);

  const onXRFrame = useCallback(async (time: number, frame: XRFrame) => {
    if (!sessionRef.current || !hitTestSourceRef.current || !refSpaceRef.current) return;

    const pose = frame.getViewerPose(refSpaceRef.current);
    if (!pose) return;

    const hitTestResults = frame.getHitTestResults(hitTestSourceRef.current);
    if (hitTestResults.length === 0) {
      if (isMountedRef.current) {
        setHitTestResult(null);
      }
      return;
    }

    const hit = hitTestResults[0];
    const hitPose = hit.getPose(refSpaceRef.current);
    
    if (hitPose && isMountedRef.current) {
      const pos = hitPose.transform.position;
      const orient = hitPose.transform.orientation;
      
      setHitTestResult({
        position: new THREE.Vector3(pos.x, pos.y, pos.z),
        orientation: new THREE.Quaternion(orient.x, orient.y, orient.z, orient.w),
      });
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
      setError(null);
      setErrorMessage(null);

      refSpaceRef.current = await xrSession.requestReferenceSpace('local-floor');
      
      if (enableAnchors) {
        try {
          if ('createAnchor' in xrSession && typeof xrSession.createAnchor === 'function') {
            setHasAnchors(true);
          }
        } catch {
          logger.debug('[WebXR] Anchor support not available');
        }
      }
      
      if (requiredFeatures.includes('hit-test') && xrSession.requestHitTestSource) {
        const source = await xrSession.requestHitTestSource({ space: refSpaceRef.current });
        hitTestSourceRef.current = source ?? null;
        setHasHitTest(true);
      }

      xrSession.addEventListener('select', onSelect);

      let frameId: number;
      const frameLoop = (time: number, frame: XRFrame) => {
        onXRFrame(time, frame);
        frameId = xrSession.requestAnimationFrame(frameLoop);
      };
      frameId = xrSession.requestAnimationFrame(frameLoop);

      xrSession.addEventListener('end', () => {
        xrSession.cancelAnimationFrame(frameId);
        sessionRef.current = null;
        hitTestSourceRef.current = null;
        refSpaceRef.current = null;
        setSession(null);
        setIsActive(false);
        setHasHitTest(false);
        setHitTestResult(null);
      });

      return true;
    } catch (err) {
      const code = mapXRError(err);
      setError(code);
      setErrorMessage((err as Error).message || 'Failed to start XR session');
      return false;
    }
  }, [sessionMode, requiredFeatures, optionalFeatures, enableAnchors, onSelect, onXRFrame]);

  const createAnchor = useCallback(async (
    position: THREE.Vector3,
    orientation?: THREE.Quaternion
  ): Promise<XRAnchor | null> => {
    if (!sessionRef.current || !refSpaceRef.current) {
      const id = `anchor-fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const anchor: XRAnchor = {
        id,
        position: position.clone(),
        orientation: orientation?.clone() ?? new THREE.Quaternion(),
        timestamp: performance.now(),
        isNative: false,
      };

      anchorsRef.current.set(id, anchor);
      setAnchors(new Map(anchorsRef.current));
      return anchor;
    }

    try {
      if ('createAnchor' in sessionRef.current && typeof sessionRef.current.createAnchor === 'function') {
        const anchorPose = new XRRigidTransform(
          { x: position.x, y: position.y, z: position.z },
          orientation ? { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w } : { x: 0, y: 0, z: 0, w: 1 }
        );
        const nativeAnchor = await sessionRef.current.createAnchor(anchorPose, refSpaceRef.current);
        
        if (nativeAnchor) {
          const id = nativeAnchor.id;
          const anchor: XRAnchor = {
            id,
            position: position.clone(),
            orientation: orientation?.clone() ?? new THREE.Quaternion(),
            timestamp: performance.now(),
            isNative: true,
            nativeAnchor,
          };

          anchorsRef.current.set(id, anchor);
          setAnchors(new Map(anchorsRef.current));
          logger.debug('[WebXR] Created native anchor:', id, position);
          return anchor;
        }
      }
    } catch (e) {
      logger.debug('[WebXR] Native anchor creation failed, using fallback:', e);
    }

    const id = `anchor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const anchor: XRAnchor = {
      id,
      position: position.clone(),
      orientation: orientation?.clone() ?? new THREE.Quaternion(),
      timestamp: performance.now(),
      isNative: false,
    };

    anchorsRef.current.set(id, anchor);
    setAnchors(new Map(anchorsRef.current));

    logger.debug('[WebXR] Created fallback anchor:', id, position);
    return anchor;
  }, []);

  const getAnchor = useCallback((id: string): XRAnchor | undefined => {
    return anchorsRef.current.get(id);
  }, []);

  const updateAnchor = useCallback((
    id: string,
    position: THREE.Vector3,
    orientation?: THREE.Quaternion
  ) => {
    const existing = anchorsRef.current.get(id);
    if (existing) {
      existing.position.copy(position);
      if (orientation) existing.orientation.copy(orientation);
      existing.timestamp = performance.now();
      setAnchors(new Map(anchorsRef.current));
    }
  }, []);

  const removeAnchor = useCallback((id: string) => {
    anchorsRef.current.delete(id);
    setAnchors(new Map(anchorsRef.current));
    logger.debug('[WebXR] Removed anchor:', id);
  }, []);

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
    hasHitTest,
    hasAnchors,
    hitTestResult,
    anchors,
    error,
    errorMessage,
    startSession,
    endSession,
    createAnchor,
    getAnchor,
    updateAnchor,
    removeAnchor,
  };
}
