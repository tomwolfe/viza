/**
 * Unified MediaProcessor for frame acquisition.
 * Handles OffscreenCanvas, aspect-ratio cropping, and ImageBitmap lifecycle.
 */

import { CONFIG } from '@/config';

const TARGET_SIZE = CONFIG.TARGET_SIZE;

let sharedCanvas: OffscreenCanvas | null = null;
let sharedCtx: OffscreenCanvasRenderingContext2D | null = null;

function getSharedCanvas(): OffscreenCanvas {
  if (!sharedCanvas) {
    sharedCanvas = new OffscreenCanvas(TARGET_SIZE, TARGET_SIZE);
    sharedCtx = sharedCanvas.getContext('2d');
    if (!sharedCtx) {
      throw new Error('Failed to get 2D context from OffscreenCanvas');
    }
  }
  return sharedCanvas;
}

function downsampleToBitmap(
  source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas
): ImageBitmap {
  const canvas = getSharedCanvas();
  const ctx = sharedCtx;
  if (!ctx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas');
  }

  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  
  const aspectRatio = sourceWidth / sourceHeight;
  let cropWidth: number;
  let cropHeight: number;
  let cropX: number;
  let cropY: number;

  if (aspectRatio > 1) {
    cropHeight = sourceHeight;
    cropWidth = sourceHeight;
    cropX = (sourceWidth - cropWidth) / 2;
    cropY = 0;
  } else {
    cropWidth = sourceWidth;
    cropHeight = sourceWidth;
    cropX = 0;
    cropY = (sourceHeight - cropHeight) / 2;
  }

  ctx.drawImage(
    source,
    cropX, cropY, cropWidth, cropHeight,
    0, 0, TARGET_SIZE, TARGET_SIZE
  );

  return canvas.transferToImageBitmap();
}

export class MediaProcessor {
  private static isValidSource(source: CanvasImageSource): boolean {
    if (!source) return false;
    const width = 'videoWidth' in source ? (source as HTMLVideoElement).videoWidth : (source as { width: number }).width;
    const height = 'videoHeight' in source ? (source as HTMLVideoElement).videoHeight : (source as { height: number }).height;
    return width > 0 && height > 0;
  }

  static captureFrame(source: CanvasImageSource): ImageBitmap | null {
    if (!this.isValidSource(source)) {
      return null;
    }

    try {
      return downsampleToBitmap(source as HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas);
    } catch (error) {
      console.error('[MediaProcessor] Frame capture failed:', error);
      return null;
    }
  }

  static captureVideoFrame(video: HTMLVideoElement): ImageBitmap | null {
    return this.captureFrame(video);
  }

  static captureCanvasFrame(canvas: HTMLCanvasElement): ImageBitmap | null {
    return this.captureFrame(canvas);
  }

  static async captureAndTransfer(
    source: CanvasImageSource,
    onTransfer: (bitmap: ImageBitmap) => void
  ): Promise<void> {
    const bitmap = this.captureFrame(source);
    if (bitmap) {
      try {
        onTransfer(bitmap);
      } finally {
        bitmap.close();
      }
    }
  }
}

export const captureFrame = MediaProcessor.captureFrame;
export const captureVideoFrame = MediaProcessor.captureVideoFrame;
export const captureCanvasFrame = MediaProcessor.captureCanvasFrame;