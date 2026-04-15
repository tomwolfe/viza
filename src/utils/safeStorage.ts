const SCHEMA_VERSION = 1;

export interface SafeStorageOptions {
  key: string;
  schemaVersion?: number;
}

export function getStorageVersion(storage: Storage, key: string): number {
  try {
    const versionKey = `${key}_version`;
    const stored = storage.getItem(versionKey);
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

export function safeGet<T>({ key, schemaVersion = SCHEMA_VERSION }: SafeStorageOptions): T | null {
  if (typeof window === 'undefined') return null;

  try {
    const storedVersion = getStorageVersion(localStorage, key);
    if (storedVersion !== schemaVersion) {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}_version`);
      return null;
    }

    const stored = localStorage.getItem(key);
    if (!stored) return null;

    return JSON.parse(stored) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      console.warn('[SafeStorage] Quota exceeded, clearing old data');
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}_version`);
    } else {
      console.warn('[SafeStorage] Failed to load:', e);
    }
    return null;
  }
}

export function safeSet<T>(data: T, { key, schemaVersion = SCHEMA_VERSION }: SafeStorageOptions): boolean {
  if (typeof window === 'undefined') return false;

  try {
    localStorage.setItem(`${key}_version`, schemaVersion.toString());
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      console.warn('[SafeStorage] Quota exceeded');
    } else {
      console.warn('[SafeStorage] Failed to save:', e);
    }
    return false;
  }
}

export function safeRemove({ key }: SafeStorageOptions): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(key);
  localStorage.removeItem(`${key}_version`);
}

export { SCHEMA_VERSION };
