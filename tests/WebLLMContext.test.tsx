import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { WebLLMProvider, useWebLLM } from '../src/contexts/WebLLMContext';
import { MockWorker } from './mocks/worker';

vi.stubGlobal('Worker', MockWorker);
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
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = new MockWorker();
    vi.stubGlobal('Worker', class extends MockWorker {});
  });

  afterEach(() => {
    vi.clearAllMocks();
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

    act(() => {
      result.current.initModel();
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    mockWorker.triggerMessage({
      type: 'worker_ready',
    });

    mockWorker.triggerMessage({
      type: 'init_complete',
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    const inferencePromise = result.current.runInference(mockImage, 'test prompt');

    await waitFor(() => {
      expect(result.current.isInferring).toBe(true);
    });

    mockWorker.triggerMessage({
      type: 'inference_complete',
      messageId: 'test-uuid-1',
      response: {
        objects: [{ name: 'test', bbox_2d: [10, 10, 50, 50], action: 'test-action' }],
      },
    });

    await inferencePromise;
  });

  it('should handle worker error gracefully', async () => {
    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    act(() => {
      result.current.initModel();
    });

    mockWorker.triggerMessage({
      type: 'worker_ready',
    });

    mockWorker.triggerMessage({
      type: 'error',
      message: 'Test error message',
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Test error message');
      expect(result.current.isModelLoading).toBe(false);
      expect(result.current.isInferring).toBe(false);
    });
  });

  it('should handle invalid response schema', async () => {
    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    act(() => {
      result.current.initModel();
    });

    mockWorker.triggerMessage({
      type: 'worker_ready',
    });

    mockWorker.triggerMessage({
      type: 'init_complete',
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    const mockImage = {
      width: 512,
      height: 512,
    } as unknown as ImageBitmap;

    const inferencePromise = result.current.runInference(mockImage, 'test prompt');

    await waitFor(() => {
      expect(result.current.isInferring).toBe(true);
    });

    mockWorker.triggerMessage({
      type: 'inference_complete',
      messageId: 'test-uuid-2',
      response: null,
    });

    await inferencePromise;

    expect(result.current.error).toBeTruthy();
  });

  it('should handle inference timeout', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useWebLLM(), {
      wrapper: WebLLMProvider,
    });

    mockWorker.triggerMessage({
      type: 'worker_ready',
    });

    mockWorker.triggerMessage({
      type: 'init_complete',
    });

    await waitFor(() => {
      expect(result.current.isModelReady).toBe(true);
    });

    const mockImage = {
      width: 512,
      height: 512,
    } as unknown as ImageBitmap;

    const inferencePromise = result.current.runInference(mockImage, 'test prompt');

    await waitFor(() => {
      expect(result.current.isInferring).toBe(true);
    });

    act(() => {
      vi.advanceTimersByTime(16000);
    });

    await inferencePromise;

    expect(result.current.error).toBe('Inference timeout after 15s');

    vi.useRealTimers();
  });
});