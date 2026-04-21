import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useWebLLMWorker } from '../src/hooks/useWebLLMWorker';
import { VizaErrorProvider } from '../src/contexts/VizaErrorContext';
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

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <VizaErrorProvider>
    {children}
  </VizaErrorProvider>
);

describe('useWebLLMWorker', () => {
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

  it('should initialize with correct default state', async () => {
    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }), { wrapper });

    expect(result.current.isInferring).toBe(false);
    expect(result.current.isDeviceCompatible).toBe(true);
    expect(result.current.isModelReady).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.errorCode).toBe(null);
  });

  it('should initialize worker and model successfully', async () => {
    const initSpy = vi.fn().mockImplementation(async () => {
      return new Promise(resolve => setTimeout(resolve, 10));
    });
    vi.spyOn(workerClient, 'createWorkerClient').mockReturnValue({
      initialize: vi.fn().mockImplementation(() => {}),
      init: initSpy,
      chat: vi.fn(),
      planning: vi.fn(),
      category: vi.fn(),
      setModelReady: vi.fn(),
      isModelReady: vi.fn().mockReturnValue(true),
      ping: vi.fn(),
      reset: vi.fn(),
      terminate: vi.fn(),
      startHeartbeat: vi.fn(),
      stopHeartbeat: vi.fn(),
      getPendingCount: vi.fn().mockReturnValue(0),
      isReady: vi.fn().mockReturnValue(true),
    } as unknown as ReturnType<typeof workerClient.createWorkerClient>);

    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }), { wrapper });

    await act(async () => {
      await result.current.initModel();
    });

    expect(initSpy).toHaveBeenCalled();
    
    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    }, { timeout: 2000 });
  });

  it('should handle device incompatibility', async () => {
    vi.spyOn(config, 'checkWebGPU').mockResolvedValue({
      supported: false,
      memoryGB: 4,
      recommendedGB: 8,
      isMobile: true,
      issues: ['Insufficient memory'],
    });

    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }), { wrapper });

    await act(async () => {
      await result.current.initModel();
    });

    expect(result.current.isDeviceCompatible).toBe(false);
    expect(result.current.errorCode).toBe('WEBGPU_NOT_SUPPORTED');
  });

  it('should handle worker initialization error', async () => {
    vi.spyOn(workerClient, 'createWorkerClient').mockReturnValue({
      initialize: vi.fn(),
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
    } as unknown as ReturnType<typeof workerClient.createWorkerClient>);

    const { result } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }), { wrapper });

    await act(async () => {
      await result.current.initModel();
    });

    await waitFor(() => {
        expect(result.current.error).toMatch(/Failed to initialize AI worker/);
        expect(result.current.errorCode).toBe('WORKER_INIT_FAILED');
    });
  });

  it('should dispose worker on unmount', async () => {
    const terminateMock = vi.fn();
    vi.spyOn(workerClient, 'createWorkerClient').mockReturnValue({
      initialize: vi.fn(),
      init: vi.fn().mockResolvedValue(undefined),
      chat: vi.fn(),
      planning: vi.fn(),
      category: vi.fn(),
      setModelReady: vi.fn(),
      isModelReady: vi.fn().mockReturnValue(true),
      ping: vi.fn(),
      reset: vi.fn(),
      terminate: terminateMock,
      startHeartbeat: vi.fn(),
      stopHeartbeat: vi.fn(),
      getPendingCount: vi.fn().mockReturnValue(0),
      isReady: vi.fn().mockReturnValue(true),
    } as unknown as ReturnType<typeof workerClient.createWorkerClient>);

    const { result, unmount } = renderHook(() => useWebLLMWorker({ modelId: 'test-model' }), { wrapper });

    await act(async () => {
      await result.current.initModel();
    });

    unmount();

    expect(terminateMock).toHaveBeenCalled();
  });
});
