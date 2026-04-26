import type { VizaErrorCode } from '@/types/worker';

export function sendError(
  messageId: string,
  message: string,
  code: VizaErrorCode,
  error?: Error,
  postMessageFn: typeof postMessage = postMessage
): void {
  postMessageFn({
    type: 'error',
    messageId,
    message,
    error: error?.toString(),
    errorCode: code,
  });
}

export function mapErrorToCode(error: unknown): VizaErrorCode {
  const err = error as Error;
  const message = err.message?.toLowerCase() ?? '';
  
  if (message.includes('timeout')) return 'INFERENCE_TIMEOUT';
  if (message.includes('memory') || message.includes('gpu')) return 'WEBGPU_NOT_SUPPORTED';
  if (message.includes('model') || message.includes('engine')) return 'MODEL_NOT_READY';
  if (message.includes('parse') || message.includes('json')) return 'INVALID_RESPONSE';
  
  return 'INFERENCE_ERROR';
}

export function hasImage(msg: { image?: ImageBitmap }): msg is { image: ImageBitmap } {
  return 'image' in msg && msg.image !== undefined;
}

export function validateImage(
  msg: { image?: ImageBitmap },
  messageId: string,
  msgType: string,
  postMessageFn: typeof postMessage = postMessage
): boolean {
  if (!hasImage(msg)) {
    sendError(messageId, `Missing image for ${msgType}`, 'WORKER_INIT_FAILED', undefined, postMessageFn);
    return false;
  }
  return true;
}

export async function bitmapToBase64(bitmap: ImageBitmap): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const base64 = canvas.toDataURL('image/jpeg', 0.8);
  bitmap.close();
  return base64;
}