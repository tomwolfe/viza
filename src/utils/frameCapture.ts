import { CONFIG, logger } from '@/config';

const TARGET_SIZE = CONFIG.TARGET_SIZE;

class BitmapPool {
  private canvasPool: (OffscreenCanvas | HTMLCanvasElement)[] = [];
  private currentCanvasIndex = 0;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  constructor() {
    this.initCanvas();
  }

  private initCanvas(): void {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(TARGET_SIZE, TARGET_SIZE);
      this.ctx = this.canvas.getContext('2d');
    } else if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = TARGET_SIZE;
      this.canvas.height = TARGET_SIZE;
      this.ctx = this.canvas.getContext('2d');
    }

    if (this.canvas) {
      this.canvasPool.push(this.canvas);
    }
  }

  getCanvasAndContext(): {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  } {
    if (!this.canvas) {
      this.initCanvas();
    }
    return {
      canvas: this.canvas!,
      ctx: this.ctx,
    };
  }

  dispose(): void {
    const OC = typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null;
    for (const c of this.canvasPool) {
      if (OC !== null && c instanceof OC) {
        (c as unknown as { close(): void }).close();
      }
    }
    this.canvasPool = [];
    this.canvas = null;
    this.ctx = null;
  }

  getStats(): { total: number; inUse: number; available: number } {
    return {
      total: this.canvasPool.length,
      inUse: 1,
      available: this.canvasPool.length - 1,
    };
  }
}

const bitmapPool = new BitmapPool();

export function resetFrameCaptureCache(): void {
  bitmapPool.dispose();
}

export function disposeFrameCapture(): void {
  bitmapPool.dispose();
}

export function getBitmapPoolStats(): { total: number; inUse: number; available: number } {
  return bitmapPool.getStats();
}

function isValidSource(source: CanvasImageSource): boolean {
  if (!source) return false;
  if (source instanceof HTMLVideoElement) {
    return source.videoWidth > 0 && source.videoHeight > 0;
  }
  const isVideoLike = 'videoWidth' in source && 'videoHeight' in source;
  if (isVideoLike) {
    return (source as unknown as HTMLVideoElement).videoWidth > 0 && (source as unknown as HTMLVideoElement).videoHeight > 0;
  }
  return (source as unknown as HTMLCanvasElement | OffscreenCanvas).width > 0 && (source as unknown as HTMLCanvasElement | OffscreenCanvas).height > 0;
}

async function downsampleToBitmap(
  source: HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas
): Promise<ImageBitmap> {
  const { canvas, ctx } = bitmapPool.getCanvasAndContext();

  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
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

  if (canvas instanceof OffscreenCanvas) {
    return canvas.transferToImageBitmap();
  }
  return createImageBitmap(canvas);
}

export async function captureFrame(source: CanvasImageSource): Promise<ImageBitmap | null> {
  if (!isValidSource(source)) {
    return null;
  }

  try {
    return await downsampleToBitmap(source as HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas);
  } catch (error) {
    logger.error('[MediaProcessor] Frame capture failed:', error);
    return null;
  }
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<ImageBitmap | null> {
  return captureFrame(video);
}

export async function captureCanvasFrame(canvas: HTMLCanvasElement): Promise<ImageBitmap | null> {
  return captureFrame(canvas);
}

export async function captureAndTransfer(
  source: CanvasImageSource,
  onTransfer: (bitmap: ImageBitmap) => void
): Promise<void> {
  const bitmap = await captureFrame(source);
  if (bitmap) {
    onTransfer(bitmap);
  }
}