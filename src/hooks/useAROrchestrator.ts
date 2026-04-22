'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useVizaOrchestrator } from '@/contexts/VizaOrchestratorContext';
import { useARSessionManager } from './useARSessionManager';
import { useARStateMachine, type ARState } from './useARStateMachine';
import { useTaskOrchestrator } from './useTaskOrchestrator';
import { useVizaError } from '@/contexts/VizaErrorContext';
import type { VisionResponse } from '@/schemas/vision';
import type { VizaErrorCode } from '@/types/worker';

interface UseAROrchestratorResult {
  arState: ARState;
  dispatchActions: {
    initModel: () => void;
    startInferencing: () => void;
    stopInferencing: () => void;
    startPlanning: () => void;
    stopPlanning: () => void;
    completeStep: () => void;
    handleError: (error: string, errorCode: string | null) => void;
    reset: () => void;
  };
  isARActive: boolean;
  isXRMode: boolean;
  xrSession: XRSession | null;
  isModelReady: boolean;
  isInferring: boolean;
  isDeviceCompatible: boolean;
  runInference: (image: ImageBitmap, prompt: string) => Promise<VisionResponse | null>;
  error: string | null;
  errorCode: VizaErrorCode | null;
  llmError: string | null;
  sceneImageRef: React.MutableRefObject<ImageBitmap | null>;
  handleStartAR: () => Promise<void>;
}

export function useAROrchestrator(): UseAROrchestratorResult {
  const { 
    unifiedError, 
    unifiedErrorCode, 
    setError: setVizaError 
  } = useVizaError();

  const {
    isModelReady,
    isInferring,
    isDeviceCompatible,
    initModel: webllmInitModel,
    runInference,
    error: llmError,
    errorCode: llmErrorCode,
    lastCompleted,
  } = useVizaOrchestrator();

  const {
    isARActive,
    isXRMode,
    xrSession,
    error: xrError,
    errorCode: xrErrorCode,
    startAR,
  } = useARSessionManager();

  const { state: arState, dispatchActions } = useARStateMachine();

  const sceneImageRef = useRef<ImageBitmap | null>(null);

  const taskOrchestrator = useTaskOrchestrator(sceneImageRef, () => {
    dispatchActions.initModel();
  });

  const handleStartAR = useCallback(async () => {
    dispatchActions.initModel();
    webllmInitModel();
    await startAR();
  }, [startAR, dispatchActions, webllmInitModel]);

  const handleVoiceInput = useCallback(() => {
    if (taskOrchestrator.isListening) {
      taskOrchestrator.stopListening?.();
    } else {
      taskOrchestrator.startListening?.();
    }
  }, [taskOrchestrator]);

  useEffect(() => {
    return () => {
      if (sceneImageRef.current) {
        sceneImageRef.current.close();
        sceneImageRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (llmError && llmErrorCode) {
      setVizaError(llmErrorCode, llmError);
    }
  }, [llmError, llmErrorCode, setVizaError]);

  useEffect(() => {
    if (xrError && xrErrorCode) {
      setVizaError(xrErrorCode, xrError);
    }
  }, [xrError, xrErrorCode, setVizaError]);

  useEffect(() => {
    if (taskOrchestrator.voiceError && taskOrchestrator.voiceErrorCode) {
      setVizaError(taskOrchestrator.voiceErrorCode as VizaErrorCode, taskOrchestrator.voiceError);
    }
  }, [taskOrchestrator.voiceError, taskOrchestrator.voiceErrorCode, setVizaError]);

  useEffect(() => {
    if (arState.type === 'error') {
      const error = (arState as any).error;
      const errorCode = (arState as any).errorCode;
      if (errorCode) {
        setVizaError(errorCode, error);
      }
    }
  }, [arState, setVizaError]);

  return {
    arState,
    dispatchActions,
    isARActive,
    isXRMode,
    xrSession,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    runInference,
    error: unifiedError,
    errorCode: unifiedErrorCode,
    llmError,
    sceneImageRef,
    handleStartAR,
  };
}
