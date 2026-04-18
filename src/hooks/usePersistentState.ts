import { useState, useCallback, useEffect, useRef } from 'react';
import { safeGet, safeSet, safeRemove, type SafeStorageOptions } from '@/utils/safeStorage';
import { logger } from '@/config';

export interface UsePersistentStateOptions<T> extends SafeStorageOptions {
  defaultValue?: T;
  persistDelayMs?: number;
  onPersistError?: (error: Error) => void;
}

interface PersistentStateInternal<T> {
  value: T;
  lastPersisted: number | null;
  persistTimeout: ReturnType<typeof setTimeout> | null;
}

function _usePersistentStateInternal<T>(key: string, options?: Partial<UsePersistentStateOptions<T>>) {
  const STORAGE_KEY = key;
  const SCHEMA_VERSION = 1;
  const persistDelayMs = options?.persistDelayMs ?? 1000;
  const onPersistError = options?.onPersistError ?? ((_error: Error) => {});
  const defaultValue = options?.defaultValue;

  const stateRef = useRef<PersistentStateInternal<T>>({
    value: defaultValue ?? (null as unknown as T),
    lastPersisted: null,
    persistTimeout: null,
  });

  const [value, setValue] = useState<T>(() => {
    const stored = safeGet<T>({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
    if (stored !== null) {
      stateRef.current.value = stored;
      stateRef.current.lastPersisted = Date.now();
      return stored;
    }
    return defaultValue ?? (null as unknown as T);
  });

  const persist = useCallback(() => {
    if (stateRef.current.lastPersisted) return;
    stateRef.current.lastPersisted = Date.now();

    try {
      safeSet(stateRef.current.value, { key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
    } catch (error) {
      stateRef.current.lastPersisted = null;
      onPersistError(error as Error);
      return;
    }
  }, [STORAGE_KEY, onPersistError]);

  const schedulePersist = useCallback(() => {
    if (stateRef.current.persistTimeout) {
      clearTimeout(stateRef.current.persistTimeout);
    }
    stateRef.current.persistTimeout = setTimeout(() => {
      persist();
    }, persistDelayMs);
  }, [persist, persistDelayMs]);

  const setValueWithPersist = useCallback((newValue: T | ((prev: T) => T)) => {
    stateRef.current.lastPersisted = null;

    const computedValue = typeof newValue === 'function'
      ? (newValue as (prev: T) => T)(stateRef.current.value)
      : newValue;
    
    stateRef.current.value = computedValue;
    stateRef.current.lastPersisted = null;

    setValue(computedValue);

    stateRef.current.lastPersisted = Date.now();

    schedulePersist();
  }, [schedulePersist]);

  useEffect(() => {
    if (stateRef.current.persistTimeout) {
      clearTimeout(stateRef.current.persistTimeout);
    }
  }, []);

  const resetValue = useCallback(() => {
    stateRef.current.lastPersisted = null;
    stateRef.current.value = defaultValue ?? (null as unknown as T);
    setValue(stateRef.current.value);
    safeRemove({ key: STORAGE_KEY });
  }, [STORAGE_KEY, defaultValue]);

  const removeValue = useCallback(() => {
    safeRemove({ key: STORAGE_KEY });
    stateRef.current.lastPersisted = null;
    stateRef.current.value = defaultValue ?? (null as unknown as T);
    setValue(stateRef.current.value);
  }, [STORAGE_KEY, defaultValue]);

  const getStoredValue = useCallback(() => {
    const stored = safeGet<T>({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
    return stored;
  }, [STORAGE_KEY]);

  return {
    value,
    setValue: setValueWithPersist,
    resetValue,
    removeValue,
    getStoredValue,
    isPersisted: stateRef.current.lastPersisted !== null,
  };
}

export function usePersistentStateHook<T>(options?: Partial<UsePersistentStateOptions<T>>): {
  value: T;
  setValue: (newValue: T | ((prev: T) => T)) => void;
  resetValue: () => void;
  removeValue: () => void;
  getStoredValue: () => T | null;
  isPersisted: boolean;
} {
  const key = options?.key ?? 'viza_default_state';
  const defaultValue = options?.defaultValue;

  return usePersistentState(key, { ...options, defaultValue });
}

export function usePersistentState<T>(
  key: string, 
  options?: Partial<UsePersistentStateOptions<T>> & { defaultValue?: T }
) {
  return _usePersistentStateInternal(key, {
    ...options,
    defaultValue: options?.defaultValue,
  });
}

export function createPersistentStateHook<T>(key: string, options?: Partial<UsePersistentStateOptions<T>>) {
  function persistentStateHook(defaultValue?: T) {
    return usePersistentState<T>(key, { ...options, defaultValue });
  }
  return persistentStateHook;
}
