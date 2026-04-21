import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebXR } from '../src/hooks/useWebXR';

const mockXrSession = {
  addEventListener: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
  enabledFeatures: [],
  requestReferenceSpace: vi.fn().mockResolvedValue({}),
  requestAnimationFrame: vi.fn().mockReturnValue(1),
  cancelAnimationFrame: vi.fn(),
  requestHitTestSource: vi.fn().mockResolvedValue({}),
};

describe('useWebXR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.navigator.xr = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
      requestSession: vi.fn().mockResolvedValue(mockXrSession),
    } as unknown as XRSystem;
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete global.navigator.xr;
  });

  it('should initialize with correct default values', async () => {
    const { result } = renderHook(() => useWebXR());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.isActive).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.hasCameraAccess).toBe(false);
  });

  it('should check for session support on mount', async () => {
    renderHook(() => useWebXR());

    await waitFor(() => {
      expect(global.navigator.xr?.isSessionSupported).toHaveBeenCalledWith('immersive-ar');
    });
  });

  it('should start session successfully', async () => {
    const { result } = renderHook(() => useWebXR());

    let success: boolean = false;
    await act(async () => {
      success = await result.current.startSession();
    });

    expect(success).toBe(true);
    expect(result.current.isActive).toBe(true);
  });

  it('should end session properly', async () => {
    const { result } = renderHook(() => useWebXR());

    await act(async () => {
      await result.current.startSession();
    });

    await act(async () => {
      await result.current.endSession();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it('should handle session end event', async () => {
    const { result } = renderHook(() => useWebXR());

    await act(async () => {
      await result.current.startSession();
    });

    const endListener = mockXrSession.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === 'end'
    )?.[1] as () => void;

    if (endListener) {
      await act(async () => {
        endListener();
      });

      expect(result.current.isActive).toBe(false);
    }
  });

  it('should clean up on unmount', async () => {
    const { result, unmount } = renderHook(() => useWebXR());

    await act(async () => {
      await result.current.startSession();
    });

    await act(async () => {
      await unmount();
    });

    expect(mockXrSession.end).toHaveBeenCalled();
  });
});