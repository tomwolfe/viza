/**
 * Unified MediaProcessor for frame acquisition.
 * Handles OffscreenCanvas, aspect-ratio cropping, and ImageBitmap lifecycle.
 */

import { CONFIG, logger } from '@/config';

const TARGET_SIZE = CONFIG.TARGET_SIZE;

let sharedCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let sharedCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
let useOffscreenCanvas = true;

function getSharedCanvas(): OffscreenCanvas | HTMLCanvasElement {
  if (!sharedCanvas) {
    if (typeof OffscreenCanvas !== 'undefined') {
      sharedCanvas = new OffscreenCanvas(TARGET_SIZE, TARGET_SIZE);
      sharedCtx = sharedCanvas.getContext('2d');
      useOffscreenCanvas = true;
    } else if (typeof document !== 'undefined') {
      sharedCanvas = document.createElement('canvas');
      sharedCanvas.width = TARGET_SIZE;
      sharedCanvas.height = TARGET_SIZE;
      sharedCtx = sharedCanvas.getContext('2d');
      useOffscreenCanvas = false;
    } else {
      throw new Error('Neither OffscreenCanvas nor document.createElement is available');
    }
    if (!sharedCtx) {
      throw new Error('Failed to get 2D context from canvas');
    }
  }
  return sharedCanvas;
}

async function downsampleToBitmap(
  source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas
): Promise<ImageBitmap> {
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

  if (useOffscreenCanvas) {
    return (canvas as OffscreenCanvas).transferToImageBitmap();
  }
  return createImageBitmap(canvas as HTMLCanvasElement);
}

export class MediaProcessor {
  private static isValidSource(source: CanvasImageSource): boolean {
    if (!source) return false;
    const width = 'videoWidth' in source ? (source as HTMLVideoElement).videoWidth : (source as { width: number }).width;
    const height = 'videoHeight' in source ? (source as HTMLVideoElement).videoHeight : (source as { height: number }).height;
    return width > 0 && height > 0;
  }

  static async captureFrame(source: CanvasImageSource): Promise<ImageBitmap | null> {
    if (!this.isValidSource(source)) {
      return null;
    }

    try {
      return await downsampleToBitmap(source as HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas);
    } catch (error) {
      logger.error('[MediaProcessor] Frame capture failed:', error);
      return null;
    }
  }

  static async captureVideoFrame(video: HTMLVideoElement): Promise<ImageBitmap | null> {
    return this.captureFrame(video);
  }

  static async captureCanvasFrame(canvas: HTMLCanvasElement): Promise<ImageBitmap | null> {
    return this.captureFrame(canvas);
  }

  static async captureAndTransfer(
    source: CanvasImageSource,
    onTransfer: (bitmap: ImageBitmap) => void
  ): Promise<void> {
    const bitmap = await this.captureFrame(source);
    if (bitmap) {
      onTransfer(bitmap);
    }
  }
}

export const captureFrame = MediaProcessor.captureFrame.bind(MediaProcessor);
export const captureVideoFrame = MediaProcessor.captureVideoFrame.bind(MediaProcessor);
export const captureCanvasFrame = MediaProcessor.captureCanvasFrame.bind(MediaProcessor);