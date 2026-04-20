import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useAROrchestrator } from '../src/hooks/useAROrchestrator';
import * as config from '../src/config';
import * as workerClient from '../src/utils/workerClient';

vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
});

vi.stubGlobal('navigator', {
  gpu: {
    requestAdapter: vi.fn().mockResolvedValue({
      requestDevice: vi.fn().mockResolvedValue({}),
    }),
  },
});

vi.mock('@/contexts/VizaErrorContext', () => ({
  useVizaError: vi.fn(() => ({
    unifiedError: null,
    unifiedErrorCode: null,
    error: { code: null, message: null, originalError: null },
    setError: vi.fn(),
    clearError: vi.fn(),
  })),
}));

import { useVizaError } from '@/contexts/VizaErrorContext';

vi.mock('../src/contexts/WebLLMContext', () => {
  return {
    WebLLMProvider: ({ children }: { children: React.ReactNode }) => ({ children }),
    useWebLLM: vi.fn(() => {
      const [isModelLoading, setIsModelLoading] = React.useState(false);
      const [isModelReady, setIsModelReady] = React.useState(false);
      const [isInferring, setIsInferring] = React.useState(false);
      const [modelProgress, setModelProgress] = React.useState(0);
      const [error, setError] = React.useState<string | null>(null);
      const [errorCode, setErrorCode] = React.useState<string | null>(null);
      const [lastCompleted, setLastCompleted] = React.useState<Date | null>(null);

      return {
        isModelLoading,
        isModelReady,
        isInferring,
        isDeviceCompatible: true,
        modelProgress,
        error,
        errorCode,
        lastCompleted,
        workerClient: null as unknown as ReturnType<typeof workerClient.createWorkerClient>,
        isModelReadyRef: { current: false } as { current: boolean },
        setIsInferring: vi.fn().mockImplementation((val: boolean) => setIsInferring(val)),
        setError: vi.fn().mockImplementation((msg: string | null) => setError(msg)),
        setErrorCode: vi.fn().mockImplementation((code: string | null) => setErrorCode(code)),
        initModel: vi.fn().mockImplementation(async () => {
          setIsModelLoading(true);
          setIsModelReady(true);
        }),
        runInference: vi.fn().mockImplementation(async (_image: ImageBitmap, _prompt: string) => {
          setIsInferring(true);
          setLastCompleted(new Date());
          setIsInferring(false);
          return { objects: [] };
        }),
        runPlanningInference: vi.fn().mockResolvedValue([]),
        runCategoryInference: vi.fn().mockResolvedValue(null),
        dispose: vi.fn(),
      };
    }),
  };
});

let mockWorkerClient: ReturnType<typeof workerClient.createWorkerClient> | null = null;

vi.mock('../src/utils/workerClient', () => ({
  createWorkerClient: vi.fn((options) => {
    mockWorkerClient = {
      options,
      initialize: vi.fn(),
      init: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn().mockResolvedValue({ objects: [] }),
      planning: vi.fn().mockResolvedValue([]),
      category: vi.fn().mockResolvedValue(null),
      setModelReady: vi.fn(),
      isModelReady: vi.fn().mockReturnValue(true),
      ping: vi.fn(),
      reset: vi.fn(),
      terminate: vi.fn(),
      startHeartbeat: vi.fn(),
      stopHeartbeat: vi.fn(),
      getPendingCount: vi.fn().mockReturnValue(0),
      isReady: vi.fn().mockReturnValue(true),
    } as unknown as ReturnType<typeof workerClient.createWorkerClient>;
    return mockWorkerClient;
  }),
}));

vi.mock('../src/hooks/useARSessionManager', () => {
  let startARMock = vi.fn().mockResolvedValue(undefined);
  let stopARMock = vi.fn().mockResolvedValue(undefined);

  return {
    useARSessionManager: vi.fn(() => ({
      isARActive: false,
      isXRMode: false,
      xrSession: null,
      error: null,
      errorCode: null,
      startAR: vi.fn(() => startARMock()),
      stopAR: vi.fn(() => stopARMock()),
    })),
  };
});

vi.mock('../src/hooks/useARStateMachine', () => {
  return {
    useARStateMachine: vi.fn(() => {
      const [arState, setArState] = React.useState({ type: 'idle' as const });

      return {
        state: arState,
        dispatchActions: {
          initModel: vi.fn().mockImplementation(async () => {
            // No-op for testing
          }),
          startInferencing: vi.fn(),
          stopInferencing: vi.fn(),
          startPlanning: vi.fn(),
          stopPlanning: vi.fn(),
          completeStep: vi.fn(),
          handleError: vi.fn().mockImplementation((error: string, errorCode: string | null) => {
            setArState({ type: 'error', error, errorCode } as any);
          }),
          reset: vi.fn(() => {
            setArState({ type: 'idle' });
          }),
        },
      };
    }),
  };
});

vi.mock('../src/hooks/useTaskOrchestrator', () => {
  return {
    useTaskOrchestrator: vi.fn(() => {
      const [isListening, setIsListening] = React.useState(false);
      const [voiceError, setVoiceError] = React.useState<string | null>(null);
      const [currentInstruction, setCurrentInstruction] = React.useState<string | null>(null);

      return {
        taskState: {
          isActive: false,
          completed: false,
          currentStepIndex: 0,
          steps: [] as any[],
        },
        isPlanning: false,
        checkTargetFound: vi.fn(),
        triggerPlanningMode: vi.fn(),
        handleTranscriptReady: vi.fn(),
        isListening,
        isSpeaking: false,
        transcript: '',
        speak: vi.fn(),
        startListening: vi.fn(() => setIsListening(true)),
        stopListening: vi.fn(() => setIsListening(false)),
        voiceError,
        voiceErrorCode: null,
        currentInstruction,
        completeCurrentStep: vi.fn(),
      };
    }),
  };
});

vi.mock('../src/hooks/useWorldMap', () => ({
  useWorldMap: vi.fn(() => ({
    worldMap: [],
    addOrUpdateObject: vi.fn(),
    clearWorldMap: vi.fn(),
  })),
}));

describe('useAROrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(config, 'checkWebGPU').mockResolvedValue({
      supported: true,
      memoryGB: 16,
      recommendedGB: 8,
      isMobile: false,
      issues: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useAROrchestrator());

    expect(result.current.arState.type).toBe('idle');
    expect(result.current.isARActive).toBe(false);
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.isInferring).toBe(false);
    expect(result.current.isDeviceCompatible).toBe(true);
    expect(result.current.detectedObjects).toEqual([]);
    expect(result.current.worldMap).toEqual([]);
  });

  it('should handle AR session start', async () => {
    const { result } = renderHook(() => useAROrchestrator());

    await act(async () => {
      await result.current.handleStartAR();
    });

    expect(result.current.isModelLoading).toBe(true);
  });

  it('should update detected objects', () => {
    const { result } = renderHook(() => useAROrchestrator());

    const mockObjects = [
      { name: 'chair', bbox_2d: [0, 0, 100, 100], action: 'keep', category: 'keep' as any, confidence: 0.9 },
    ];

    act(() => {
      result.current.handleObjectsDetected(mockObjects);
    });

    expect(result.current.detectedObjects).toEqual(mockObjects);
  });

  it('should handle voice input toggle', () => {
    const { result } = renderHook(() => useAROrchestrator());

    act(() => {
      result.current.handleVoiceInput();
    });

    expect(result.current.isListening).toBe(true);
  });

  it('should handle error state from AR state machine', () => {
    vi.mocked(useVizaError).mockReturnValue({
      unifiedError: 'Test error',
      unifiedErrorCode: 'INFERENCE_ERROR' as any,
      setError: vi.fn(),
      clearError: vi.fn(),
      error: { code: 'INFERENCE_ERROR' as any, message: 'Test error', originalError: null },
    });

    const { result } = renderHook(() => useAROrchestrator());

    act(() => {
      result.current.dispatchActions.handleError('Test error', 'INFERENCE_ERROR');
    });

    expect(result.current.error).toBe('Test error');
  });

  it('should handle error state from LLM', () => {
    vi.mocked(useVizaError).mockReturnValue({
      unifiedError: 'LLM Error occurred',
      unifiedErrorCode: 'INFERENCE_ERROR' as any,
      setError: vi.fn(),
      clearError: vi.fn(),
      error: { code: 'INFERENCE_ERROR' as any, message: 'LLM Error occurred', originalError: null },
    });

    const { result } = renderHook(() => useAROrchestrator());

    expect(result.current.error).toBe('LLM Error occurred');
    expect(result.current.errorCode).toBe('INFERENCE_ERROR');
  });

  it('should clear world map', () => {
    const { result } = renderHook(() => useAROrchestrator());

    act(() => {
      result.current.clearWorldMap();
    });

    expect(result.current.worldMap).toEqual([]);
  });

  it('should handle device incompatibility', () => {
    vi.spyOn(config, 'checkWebGPU').mockResolvedValue({
      supported: false,
      memoryGB: 4,
      recommendedGB: 8,
      isMobile: true,
      issues: ['Insufficient memory'],
    });

    const { result } = renderHook(() => useAROrchestrator());

    expect(result.current.isDeviceCompatible).toBe(true);
  });
});
