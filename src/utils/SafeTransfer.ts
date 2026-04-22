export interface TransferableResult<T> {
  transferred: boolean;
  data: T;
}

export function safeTransfer<T>(
  bitmap: ImageBitmap,
  fn: () => T,
  _transferList: Transferable[]
): TransferableResult<T> {
  try {
    const result = fn();
    return { transferred: true, data: result };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

export async function safeTransferAsync<T>(
  bitmap: ImageBitmap,
  fn: () => Promise<T>,
  _transferList: Transferable[]
): Promise<TransferableResult<T>> {
  try {
    const result = await fn();
    return { transferred: true, data: result };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

export function ensureBitmapClosed(bitmap: ImageBitmap | null | undefined): void {
  if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
    bitmap.close();
  }
}

export function tryCloseBitmap(bitmap: ImageBitmap | null): boolean {
  if (!bitmap) return false;
  if (bitmap.width > 0 && bitmap.height > 0) {
    bitmap.close();
    return true;
  }
  return false;
}

export function isBitmapValid(bitmap: ImageBitmap | null | undefined): boolean {
  return !!bitmap && bitmap.width > 0 && bitmap.height > 0;
}