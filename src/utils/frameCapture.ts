import { CONFIG, logger } from '@/config';

const TARGET_SIZE = CONFIG.TARGET_SIZE;

class FrameCaptureManager {
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  getCanvasAndContext(): {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  } {
    if (this.canvas && this.ctx) {
      return {
        canvas: this.canvas,
        ctx: this.ctx,
      };
    }

    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(TARGET_SIZE, TARGET_SIZE);
      this.ctx = this.canvas.getContext('2d');
    } else if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = TARGET_SIZE;
      this.canvas.height = TARGET_SIZE;
      this.ctx = this.canvas.getContext('2d');
    } else {
      throw new Error('Neither OffscreenCanvas nor document.createElement is available');
    }

    return { canvas: this.canvas, ctx: this.ctx };
  }

 dispose(): void {
    if (this.canvas) {
      if (this.canvas instanceof OffscreenCanvas) {
        try {
          (this.canvas as unknown as { close(): void }).close();
        } catch {
          // offscreen canvas close may fail in some browsers
        }
      } else if (this.canvas instanceof HTMLCanvasElement) {
        const ctx = this.canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
      }
      this.canvas = null;
      this.ctx = null;
    }
  }
}

const manager = new FrameCaptureManager();

export function resetFrameCaptureCache(): void {
  manager.dispose();
}

export function disposeFrameCapture(): void {
  manager.dispose();
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
  const { canvas, ctx } = manager.getCanvasAndContext();

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