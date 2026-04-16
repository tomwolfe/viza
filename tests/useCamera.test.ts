import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCamera } from '../src/hooks/useCamera';

vi.mock('../src/hooks/useUserMedia', () => ({
  useUserMedia: vi.fn(() => ({
    videoElement: null,
    stream: null,
    start: vi.fn().mockResolvedValue(true),
    stop: vi.fn(),
    error: null,
  })),
}));

vi.mock('../src/hooks/useWebXR', () => ({
  useWebXR: vi.fn(() => ({
    isSupported: false,
    isActive: false,
    session: null,
    startSession: vi.fn().mockResolvedValue(false),
    endSession: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('useCamera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should initialize with idle status', async () => {
    const { result } = renderHook(() =>
      useCamera({ isActive: false })
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.videoElement).toBeNull();
  });

  it('should transition to requesting status when startCamera is called', async () => {
    const { result } = renderHook(() =>
      useCamera({ isActive: false })
    );

    await act(async () => {
      await result.current.startXRSession();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('requesting');
    });
  });

  it('should handle error state properly', async () => {
    const { result } = renderHook(() =>
      useCamera({ isActive: false })
    );

    act(() => {
      result.current.resetError();
    });

    expect(result.current.retryCount).toBe(0);
    expect(result.current.error).toBeNull();
  });
});