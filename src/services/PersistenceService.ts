import { safeGet, safeSet, safeRemove, SafeStorageOptions, SCHEMA_VERSION } from '@/utils/safeStorage';
import { logger } from '@/config';

const EXPIRY_HOURS = 24;
const EXPIRY_MS = EXPIRY_HOURS * 60 * 60 * 1000;

export interface PersistenceServiceOptions extends SafeStorageOptions {
  expiryMs?: number;
}

export class PersistenceService<T> {
  private key: string;
  private schemaVersion: number;
  private expiryMs: number;

  constructor(options: PersistenceServiceOptions) {
    this.key = options.key;
    this.schemaVersion = options.schemaVersion ?? SCHEMA_VERSION;
    this.expiryMs = options.expiryMs ?? EXPIRY_MS;
  }

  save(data: T): boolean {
    const payload = {
      data,
      timestamp: Date.now(),
    };
    return safeSet(payload, { key: this.key, schemaVersion: this.schemaVersion });
  }

  load(): T | null {
    const stored = safeGet<{ data: T; timestamp: number }>({ key: this.key, schemaVersion: this.schemaVersion });
    if (!stored) return null;

    if (Date.now() - stored.timestamp > this.expiryMs) {
      logger.debug(`[PersistenceService] Data expired for key: ${this.key}`);
      this.clear();
      return null;
    }

    return stored.data;
  }

  clear(): void {
    safeRemove({ key: this.key });
  }
}

export function clearExpiredData(keys: string[], expiryMs: number = EXPIRY_MS): number {
  let cleared = 0;
  const now = Date.now();

  for (const key of keys) {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) continue;

      const parsed = JSON.parse(stored) as { timestamp?: number };
      if (parsed.timestamp && now - parsed.timestamp > expiryMs) {
        localStorage.removeItem(key);
        localStorage.removeItem(`${key}_version`);
        cleared++;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return cleared;
}