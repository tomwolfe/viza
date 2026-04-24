import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureFrame, resetFrameCaptureCache } from '../src/utils/frameCapture';
import { CONFIG } from '@/config';

// Mock ImageBitmap
class MockImageBitmap {
  width = CONFIG.TARGET_SIZE;
  height = CONFIG.TARGET_SIZE;
  close = vi.fn();
}

describe('Frame Capture Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFrameCaptureCache();
    
    // Mock OffscreenCanvas
    if (typeof OffscreenCanvas === 'undefined') {
      (global as any).OffscreenCanvas = class MockOffscreenCanvas {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return {
            drawImage: vi.fn(),
          };
        }
        transferToImageBitmap() {
          return new MockImageBitmap();
        }
        close() {}
      };
    }

    // Mock createImageBitmap
    if (typeof createImageBitmap === 'undefined') {
      (global as any).createImageBitmap = vi.fn().mockResolvedValue(new MockImageBitmap());
    }
  });

  it('should return null if source is invalid', async () => {
    // @ts-expect-error - intentionally testing null input handling
    await expect(captureFrame(null)).resolves.toBeNull();
  });

  it('should successfully downsample from a video element', async () => {
    const mockVideo = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as unknown as HTMLVideoElement;

    const bitmap = await captureFrame(mockVideo);
    expect(bitmap).toBeInstanceOf(MockImageBitmap);
  });

  it('should handle missing canvas context gracefully', async () => {
    // Force getContext to return null
    const originalGetContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = vi.fn().mockReturnValue(null);

    const mockVideo = {
      videoWidth: 100,
      videoHeight: 100,
    } as unknown as HTMLVideoElement;

    const bitmap = await captureFrame(mockVideo);
    expect(bitmap).toBeNull();

    // Restore
    OffscreenCanvas.prototype.getContext = originalGetContext;
  });
});
