import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebLLMWorker } from '../src/hooks/useWebLLMWorker';
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

describe('useWebLLMWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct default state', async () => {
    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }));

    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.modelProgress).toBe(0);
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.isInferring).toBe(false);
    expect(result.current.isDeviceCompatible).toBe(true);
    expect(result.current.error).toBe(null);
    expect(result.current.errorCode).toBe(null);
  });

  it('should initialize worker and model successfully', async () => {
    vi.spyOn(config, 'checkWebGPU').mockResolvedValue({
      supported: true,
      memoryGB: 16,
      recommendedGB: 8,
      isMobile: false,
      issues: [],
    });

    vi.spyOn(workerClient, 'createWorkerClient').mockReturnValue({
      initialize: vi.fn().mockImplementation(() => {}),
      init: vi.fn().mockImplementation(() => {
        config.CONFIG.DEFAULT_MODEL;
        return Promise.resolve();
      }),
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
      sendMessage: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof workerClient.createWorkerClient>);

    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }));

    await act(async () => {
      await result.current.initModel();
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
      expect(result.current.isModelLoading).toBe(false);
    });

    expect(result.current.modelProgress).toBe(100);
    expect(result.current.error).toBe(null);
  });

  it('should handle device incompatibility', async () => {
    const spy = vi.spyOn(config, 'checkWebGPU');
    spy.mockResolvedValue({
      supported: false,
      memoryGB: 4,
      recommendedGB: 8,
      isMobile: true,
      issues: ['Insufficient memory'],
    });

    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }));

    await act(async () => {
      await result.current.initModel();
    });

    expect(spy).toHaveBeenCalled();
    expect(result.current.isDeviceCompatible).toBe(false);
    expect(result.current.errorCode).toBe('WEBGPU_NOT_SUPPORTED');
  });

  it('should handle worker initialization error', async () => {
    vi.spyOn(config, 'checkWebGPU').mockResolvedValue({
      supported: true,
      memoryGB: 16,
      recommendedGB: 8,
      isMobile: false,
      issues: [],
    });

    vi.spyOn(workerClient, 'createWorkerClient').mockReturnValue({
      initialize: vi.fn().mockImplementation(() => {}),
      init: vi.fn().mockRejectedValue(new Error('Worker init failed')),
      chat: vi.fn(),
      planning: vi.fn(),
      category: vi.fn(),
      setModelReady: vi.fn(),
      isModelReady: vi.fn().mockReturnValue(false),
      ping: vi.fn(),
      reset: vi.fn(),
      terminate: vi.fn(),
      startHeartbeat: vi.fn(),
      stopHeartbeat: vi.fn(),
      getPendingCount: vi.fn().mockReturnValue(0),
      isReady: vi.fn().mockReturnValue(false),
      sendMessage: vi.fn().mockRejectedValue(new Error('Worker init failed')),
    } as unknown as ReturnType<typeof workerClient.createWorkerClient>);

    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }));

    await act(async () => {
      await result.current.initModel();
    });

    expect(result.current.error).toBe('Worker init failed');
    expect(result.current.errorCode).toBe('WORKER_INIT_FAILED');
  });

  it('should dispose worker on unmount', async () => {
    vi.spyOn(config, 'checkWebGPU').mockResolvedValue({
      supported: true,
      memoryGB: 16,
      recommendedGB: 8,
      isMobile: false,
      issues: [],
    });

    const terminateMock = vi.fn();
    const heartbeatMock = vi.fn();

    vi.spyOn(workerClient, 'createWorkerClient').mockReturnValue({
      initialize: vi.fn().mockImplementation(() => {}),
      init: vi.fn().mockImplementation(() => Promise.resolve()),
      chat: vi.fn().mockResolvedValue({ objects: [] }),
      planning: vi.fn().mockResolvedValue([]),
      category: vi.fn().mockResolvedValue(null),
      setModelReady: vi.fn(),
      isModelReady: vi.fn().mockReturnValue(true),
      ping: vi.fn(),
      reset: vi.fn(),
      terminate: terminateMock,
      startHeartbeat: heartbeatMock,
      stopHeartbeat: heartbeatMock,
      getPendingCount: vi.fn().mockReturnValue(0),
      isReady: vi.fn().mockReturnValue(true),
      sendMessage: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof workerClient.createWorkerClient>);

    const { result, unmount } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }));

    await act(async () => {
      await result.current.initModel();
    });

    unmount();

    expect(terminateMock).toHaveBeenCalled();
    expect(heartbeatMock).toHaveBeenCalled();
  });
});
