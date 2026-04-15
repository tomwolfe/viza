import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInferenceLoop, type InferenceStatus } from '@/hooks/useInferenceLoop';
import type { DetectedObject } from '@/schemas/vision';

vi.useFakeTimers();

const mockDetectedObjects: DetectedObject[] = [
  {
    name: 'test object',
    bbox_2d: [100, 100, 200, 200],
    action: 'keep',
    category: 'keep',
    confidence: 0.9,
  },
];

const createMockImageBitmap = () => {
  return {
    close: vi.fn(),
    width: 512,
    height: 512,
  } as unknown as ImageBitmap;
};

describe('useInferenceLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with idle status', async () => {
    const runInference = vi.fn().mockResolvedValue({
      objects: mockDetectedObjects,
      rawText: 'test response',
    });

    const captureFrame = vi.fn().mockResolvedValue(createMockImageBitmap());
    const onObjectsDetected = vi.fn();

    const { result } = renderHook(() =>
      useInferenceLoop({
        runInference,
        captureFrame,
        onObjectsDetected,
        intervalMs: 4000,
      })
    );

    expect(result.current.status).toBe('idle');
  });

  it('should transition through status states during inference', async () => {
    const captureFrame = vi.fn().mockImplementation(() => {
      return createMockImageBitmap();
    });

    const runInference = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { objects: mockDetectedObjects };
    });

    const onObjectsDetected = vi.fn();

    const { result } = renderHook(() =>
      useInferenceLoop({
        runInference,
        captureFrame,
        onObjectsDetected,
        intervalMs: 4000,
      })
    );

    const executePromise = result.current.run('test prompt');

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe('capturing');

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    await executePromise;

    expect(result.current.status).toBe('idle');
  });

  it('should abort previous inference when voice triggered', async () => {
    const captureFrame = vi.fn().mockResolvedValue(createMockImageBitmap());

    let callCount = 0;
    const runInference = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { objects: callCount === 1 ? mockDetectedObjects : [] };
    });

    const onObjectsDetected = vi.fn();

    const { result } = renderHook(() =>
      useInferenceLoop({
        runInference,
        captureFrame,
        onObjectsDetected,
        intervalMs: 4000,
      })
    );

    const firstPromise = result.current.run('first prompt');

    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(result.current.status).toBe('capturing');

    const secondPromise = result.current.run('second prompt', true);

    await firstPromise;
    await secondPromise;

    expect(result.current.status).toBe('idle');
  });
});