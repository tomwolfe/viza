export interface TransferableResult<T> {
  transferred: boolean;
  data: T;
}

export function safeTransfer<T>(
  bitmap: ImageBitmap,
  fn: () => T,
  transferList: Transferable[]
): TransferableResult<T> {
  try {
    const result = fn();
    return { transferred: true, data: result };
  } catch (error) {
    try {
      bitmap.close();
    } catch {}
    throw error;
  }
}

export async function safeTransferAsync<T>(
  bitmap: ImageBitmap,
  fn: () => Promise<T>,
  transferList: Transferable[]
): Promise<TransferableResult<T>> {
  try {
    const result = await fn();
    return { transferred: true, data: result };
  } catch (error) {
    try {
      bitmap.close();
    } catch {}
    throw error;
  }
}

export function ensureBitmapClosed(bitmap: ImageBitmap | null | undefined): void {
  if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
    try {
      bitmap.close();
    } catch {}
  }
}

export function tryCloseBitmap(bitmap: ImageBitmap | null): boolean {
  if (!bitmap) return false;
  try {
    if (bitmap.width > 0 && bitmap.height > 0) {
      bitmap.close();
      return true;
    }
  } catch {}
  return false;
}

export function isBitmapValid(bitmap: ImageBitmap | null | undefined): boolean {
  return !!bitmap && bitmap.width > 0 && bitmap.height > 0;
}