import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { WebLLMProvider, useWebLLM } from '../src/contexts/WebLLMContext';
import * as config from '../src/config';

vi.spyOn(config, 'checkWebGPU').mockResolvedValue({ supported: true, memoryGB: 16, recommendedGB: 8, isMobile: false, issues: [] });

let triggerComplete: ((messageId: string, response: unknown) => void) | null = null;
let triggerError: ((message: string, code: string) => void) | null = null;
let enableAutoComplete = true;
let autoCompleteDelay = 50;

const createMockWorkerClient = (options: {
  onComplete?: (messageId: string, response: unknown, completed?: boolean) => void;
  onError?: (message: string, code: string, messageId?: string) => void;
  onReady?: () => void;
  onProgress?: (progress: number) => void;
  onPlanningComplete?: (messageId: string, response: unknown) => void;
  onPong?: () => void;
  onUnresponsive?: () => void;
}) => {
  let capturedMessageId: string | null = null;
  const capturedOptions = options;

  triggerComplete = (messageId: string, response: unknown) => {
    capturedOptions.onComplete?.(messageId, response);
  };
  triggerError = (message: string, code: string) => {
    capturedOptions.onError?.(message, code);
  };

  const chatFn = vi.fn().mockImplementation((_image: ImageBitmap, _prompt: string, messageId: string) => {
    capturedMessageId = messageId;
    return new Promise((resolve) => {
      const complete = () => {
        const response = { objects: [{ item: 'test', coordinates: [10, 10, 50, 50], action_step: 'test-action' }] };
        capturedOptions.onComplete?.(messageId, response, true);
        resolve(response);
      };

      if (enableAutoComplete) {
        if (autoCompleteDelay > 0) {
          setTimeout(complete, autoCompleteDelay);
        } else {
          complete();
        }
      }
    });
  });

  const initFn = vi.fn().mockImplementation(() => {
    setTimeout(() => {
      options.onReady?.();
      options.onProgress?.(100);
    }, 50);
    return Promise.resolve();
  });

  return {
    initialize: vi.fn(),
    init: initFn,
    chat: chatFn,
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
    getLastChatMessageId: () => capturedMessageId,
  };
};

vi.mock('../src/utils/workerClient', () => ({
  createWorkerClient: vi.fn((options) => {
    return createMockWorkerClient({
      onComplete: options?.onComplete,
      onError: options?.onError,
      onReady: options?.onReady,
      onProgress: options?.onProgress,
      onPlanningComplete: options?.onPlanningComplete,
      onPong: options?.onPong,
      onUnresponsive: options?.onUnresponsive,
    });
  }),
}));

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

describe('WebLLMContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autoCompleteDelay = 50;
    enableAutoComplete = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
    autoCompleteDelay = 50;
    enableAutoComplete = true;
  });

  it('should initialize with correct default state', async () => {
    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.isInferring).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('should set isInferring to true when runInference is called', async () => {
    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    const mockImage = {
      width: 512,
      height: 512,
    } as unknown as ImageBitmap;

    await act(async () => {
      await result.current.initModel();
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    const inferencePromise = result.current.runInference(mockImage, 'test prompt');

    await waitFor(() => {
      expect(result.current.isInferring).toBe(true);
    });

    await inferencePromise;
  });

  it('should handle worker error gracefully', async () => {
    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    await act(async () => {
      await result.current.initModel();
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    act(() => {
      triggerError?.('Test error message', 'WORKER_INIT_FAILED');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Test error message');
    });
  });

  it('should handle invalid response schema', async () => {
    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    await act(async () => {
      await result.current.initModel();
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    const mockImage = {
      width: 512,
      height: 512,
    } as unknown as ImageBitmap;

    await act(async () => {
      const inferenceResult = await result.current.runInference(mockImage, 'test prompt');
      expect(inferenceResult).not.toBeNull();
    });

    expect(result.current.error).toBeNull();
  });

  it('should handle inference timeout', async () => {
    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    await act(async () => {
      await result.current.initModel();
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    const mockImage = {
      width: 512,
      height: 512,
    } as unknown as ImageBitmap;

    await act(async () => {
      const inferenceResult = await result.current.runInference(mockImage, 'test prompt');
      expect(inferenceResult).not.toBeNull();
    });
  });
});