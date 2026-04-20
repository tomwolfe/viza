'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { safeGet, safeSet, SCHEMA_VERSION } from '@/utils/safeStorage';

export interface UseSyncedStorageOptions<T> {
  defaultValue: T;
  schemaVersion?: number;
}

export function useSyncedStorage<T>(
  key: string,
  options: UseSyncedStorageOptions<T>
) {
  const { defaultValue, schemaVersion = SCHEMA_VERSION } = options;

  const [state, setState] = useState<T>(() => {
    const stored = safeGet<T>({ key, schemaVersion });
    return stored !== null ? stored : defaultValue;
  });

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    safeSet(state, { key, schemaVersion });
  }, [key, state, schemaVersion]);

  const setSyncedState = useCallback((newValue: T | ((prev: T) => T)) => {
    setState(newValue);
  }, []);

  return [state, setSyncedState] as const;
}
