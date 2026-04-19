import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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

vi.mock('../src/contexts/WebLLMContext', () => {
  const state = {
    isModelLoadingState: false,
    isModelReadyState: false,
    isInferringState: false,
    error: null as string | null,
    errorCode: null as string | null,
    modelProgress: 0,
    workerClient: null as unknown as ReturnType<typeof workerClient.createWorkerClient>,
    isModelReadyRef: { current: false } as { current: boolean },
    setIsInferring: vi.fn(),
    setError: vi.fn(),
    setErrorCode: vi.fn(),
  };

  return {
    WebLLMProvider: ({ children }: { children: import('react').ReactNode }) => {
      return ({ children }: { children: import('react').ReactNode }) => children;
    },
    useWebLLM: vi.fn(() => {
      return {
        get isModelLoading() { return state.isModelLoadingState; },
        get isModelReady() { return state.isModelReadyState; },
        get isInferring() { return state.isInferringState; },
        get isDeviceCompatible() { return true; },
        get modelProgress() { return state.modelProgress; },
        get error() { return state.error; },
        get errorCode() { return state.errorCode; },
        get lastCompleted() { return false; },
        workerClient: state.workerClient,
        isModelReadyRef: state.isModelReadyRef,
        setIsInferring: state.setIsInferring,
        setError: state.setError,
        setErrorCode: state.setErrorCode,
        initModel: vi.fn().mockImplementation(async () => {
          state.isModelLoadingState = true;
          await new Promise(resolve => setTimeout(resolve, 50));
          state.isModelReadyState = true;
          state.isModelLoadingState = false;
        }),
        runInference: vi.fn().mockImplementation(async () => {
          state.isInferringState = true;
          const result = { objects: [] };
          state.isInferringState = false;
          return result;
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
  const state = {
    isModelLoadingState: false,
    isModelReadyState: false,
    isInferringState: false,
    error: null as string | null,
    errorCode: null as string | null,
  };

  const arState = { type: 'idle' as const };

  const mockInitModel = vi.fn().mockImplementation(async () => {
    state.isModelLoadingState = true;
    await new Promise(resolve => setTimeout(resolve, 50));
    state.isModelReadyState = true;
    state.isModelLoadingState = false;
  });

  return {
    useARStateMachine: vi.fn(() => {
      return {
        get state() { return arState; },
        dispatchActions: {
          initModel: vi.fn(() => mockInitModel()),
          startInferencing: vi.fn(() => { state.isInferringState = true; }),
          stopInferencing: vi.fn(() => { state.isInferringState = false; }),
          startPlanning: vi.fn(),
          stopPlanning: vi.fn(),
          completeStep: vi.fn(),
          handleError: vi.fn((error: string, errorCode: string | null) => {
            state.error = error;
            state.errorCode = errorCode;
            Object.assign(arState, { type: 'error', error, errorCode });
          }),
          reset: vi.fn(() => {
            state.error = null;
            state.errorCode = null;
            Object.assign(arState, { type: 'idle' });
          }),
        },
      };
    }),
  };
});

vi.mock('../src/hooks/useTaskOrchestrator', () => {
  const taskState = {
    isActive: false,
    completed: false,
    currentStepIndex: 0,
    steps: [],
    isListeningState: false,
  };
  return {
    useTaskOrchestrator: vi.fn(() => ({
      taskState,
      isPlanning: false,
      checkTargetFound: vi.fn(),
      triggerPlanningMode: vi.fn(),
      handleTranscriptReady: vi.fn(),
      get isListening() { return taskState.isListeningState; },
      get isSpeaking() { return false; },
      get transcript() { return ''; },
      speak: vi.fn(),
      startListening: vi.fn(() => { taskState.isListeningState = true; }),
      stopListening: vi.fn(() => { taskState.isListeningState = false; }),
      voiceError: null,
      voiceErrorCode: null,
      currentInstruction: null,
      completeCurrentStep: vi.fn(),
    })),
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
      { name: 'chair', bbox_2d: [0, 0, 100, 100], action: 'keep', category: 'keep', confidence: 0.9 },
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
    const { result } = renderHook(() => useAROrchestrator());

    act(() => {
      result.current.dispatchActions.handleError('Test error', null);
    });

    expect(result.current.error).toBe('Test error');
  });

  it('should handle error state from LLM', () => {
    const { result } = renderHook(() => useAROrchestrator());

    const mockWebLLM = {
      ...result.current,
      llmError: 'LLM Error occurred',
      errorCode: 'INFERENCE_ERROR' as any,
    };

    act(() => {
      (result.current as any).llmError = 'LLM Error occurred';
      (result.current as any).errorCode = 'INFERENCE_ERROR';
    });

    expect(result.current.llmError).toBe('LLM Error occurred');
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
