/**
 * Frame capture and downsampling utilities.
 * Converts camera frames to ImageBitmap for WebLLM inference.
 */

const TARGET_SIZE = 512; // 512x512 for WebGPU VRAM efficiency

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

  // Calculate crop to maintain aspect ratio
  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  
  const aspectRatio = sourceWidth / sourceHeight;
  let cropWidth: number;
  let cropHeight: number;
  let cropX: number;
  let cropY: number;

  // Center crop to square
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

  // Draw cropped and downscaled frame
  ctx.drawImage(
    source,
    cropX, cropY, cropWidth, cropHeight, // Source crop
    0, 0, TARGET_SIZE, TARGET_SIZE       // Destination
  );

  // Convert to ImageBitmap for transfer to worker
  return canvas.transferToImageBitmap();
}

/**
 * Capture a frame from a video element and downsample it.
 * Waits for the video to be ready if needed.
 */
export async function captureVideoFrame(video: HTMLVideoElement): Promise<ImageBitmap | null> {
  if (!video.videoWidth || !video.videoHeight) {
    return null;
  }

  return downsampleFrame(video);
}

/**
 * Capture a frame from a canvas element and downsample it.
 */
export async function captureCanvasFrame(canvas: HTMLCanvasElement): Promise<ImageBitmap> {
  return downsampleFrame(canvas);
}
