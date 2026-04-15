/**
 * Frame capture and downsampling utilities.
 * Converts camera frames to ImageBitmap for WebLLM inference.
 * Creates local OffscreenCanvas per capture to ensure thread-safety.
 */

import { CONFIG } from '@/config';

const TARGET_SIZE = CONFIG.TARGET_SIZE;

/**
 * Downsample a video frame or canvas to TARGET_SIZE x TARGET_SIZE.
 * Returns an ImageBitmap ready for WebLLM.
 */
export async function downsampleFrame(
  source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(TARGET_SIZE, TARGET_SIZE);
  const ctx = canvas.getContext('2d');
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

/**
 * Capture a frame from a video or canvas element and downsample it.
 * Unified function for all CanvasImageSource types.
 */
export async function captureFrame(source: CanvasImageSource): Promise<ImageBitmap | null> {
  const width = 'videoWidth' in source ? (source as HTMLVideoElement).videoWidth : (source as { width: number }).width;
  const height = 'videoHeight' in source ? (source as HTMLVideoElement).videoHeight : (source as { height: number }).height;
  
  if (!width || !height) {
    return null;
  }

  return downsampleFrame(source as HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas);
}

export const captureVideoFrame = captureFrame;
export const captureCanvasFrame = captureFrame;
