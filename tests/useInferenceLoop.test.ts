import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInferenceLoop } from '@/hooks/useInferenceLoop';
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

  it('should not start inference when already inferring', async () => {
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
        isInferring: true,
        intervalMs: 4000,
      })
    );

    act(() => {
      result.current.run('test prompt');
    });

    expect(runInference).not.toHaveBeenCalled();
  });

  it('should process frame when not inferring', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    
    const mockVideo = {
      videoWidth: 640,
      videoHeight: 480,
    } as unknown as HTMLVideoElement;
    
    const captureFrame = vi.fn().mockResolvedValue(createMockImageBitmap());

    const runInference = vi.fn().mockResolvedValue({ objects: mockDetectedObjects });

    const onObjectsDetected = vi.fn();

    const { result } = renderHook(() =>
      useInferenceLoop({
        runInference,
        captureFrame,
        isInferring: false,
        onObjectsDetected,
        intervalMs: 4000,
      })
    );

    result.current.setVideoSource(mockVideo);
    result.current.run('test prompt');

    await act(async () => {
      vi.advanceTimersByTime(60);
    });

    expect(runInference).toHaveBeenCalled();
  });

  it('should not set up interval when not active', async () => {
    const runInference = vi.fn();
    const captureFrame = vi.fn();
    const onObjectsDetected = vi.fn();

    renderHook(() =>
      useInferenceLoop({
        runInference,
        captureFrame,
        onObjectsDetected,
        isInferring: false,
        isActive: false,
        intervalMs: 4000,
      })
    );

    expect(runInference).not.toHaveBeenCalled();
  });

  it('should set up interval when active', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    
    const mockVideo = {
      videoWidth: 640,
      videoHeight: 480,
    } as unknown as HTMLVideoElement;
    
    const runInference = vi.fn().mockResolvedValue({ objects: mockDetectedObjects });
    const captureFrame = vi.fn().mockResolvedValue(createMockImageBitmap());
    const onObjectsDetected = vi.fn();

    const { result } = renderHook(() =>
      useInferenceLoop({
        runInference,
        captureFrame,
        onObjectsDetected,
        isInferring: false,
        isActive: true,
        intervalMs: 4000,
      })
    );

    result.current.setVideoSource(mockVideo);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(runInference).toHaveBeenCalled();
  });
});