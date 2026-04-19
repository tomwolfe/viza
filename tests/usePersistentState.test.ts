import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistentState, type UsePersistentStateOptions } from '@/hooks/usePersistentState';
import { safeGet, safeSet, safeRemove } from '@/utils/safeStorage';

vi.mock('@/utils/safeStorage', () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
  SCHEMA_VERSION: 1,
}));

const STORAGE_KEY = 'viza_persistent_test';

describe('usePersistentState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with stored value', () => {
    vi.mocked(safeGet).mockReturnValue({ value: 'stored' });

    const { result } = renderHook(() =>
      usePersistentState(STORAGE_KEY, { schemaVersion: 1, defaultValue: { value: 'default' } as UsePersistentStateOptions<unknown>['defaultValue'] })
    );

    expect(result.current.value).toEqual({ value: 'stored' });
  });

  it('should update value and schedule persist', () => {
    vi.useFakeTimers();
    
    const { result } = renderHook(() =>
      usePersistentState(STORAGE_KEY, { defaultValue: { value: 'default' } })
    );

    act(() => {
      result.current.setValue({ value: 'updated' });
    });

    expect(result.current.value).toEqual({ value: 'updated' });
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.isPersisted).toBe(true);
    
    vi.useRealTimers();
  });

  it('should reset value to default', () => {
    const { result } = renderHook(() =>
      usePersistentState(STORAGE_KEY, { defaultValue: { value: 'default' } })
    );

    act(() => {
      result.current.setValue({ value: 'updated' });
    });

    act(() => {
      result.current.resetValue();
    });

    expect(result.current.value).toEqual({ value: 'default' });
  });

  it('should remove persisted value', () => {
    const { result } = renderHook(() =>
      usePersistentState(STORAGE_KEY, { defaultValue: { value: 'default' } })
    );

    act(() => {
      result.current.removeValue();
    });

    expect(result.current.value).toEqual({ value: 'default' });
    expect(result.current.isPersisted).toBe(false);
  });

it('should handle function updates', () => {
    vi.mocked(safeGet).mockReturnValue(null);

    const { result } = renderHook(() =>
      usePersistentState(STORAGE_KEY, { schemaVersion: 1, defaultValue: { counter: 0 } as UsePersistentStateOptions<unknown>['defaultValue'] })
    );

    expect(result.current.value).toEqual({ counter: 0 });

    act(() => {
      result.current.setValue((prev: { counter: number }) => ({ counter: prev.counter + 1 }));
    });

    expect(result.current.value).toEqual({ counter: 1 });
  });

  it('should retrieve stored value independently', () => {
    vi.mocked(safeGet).mockReturnValue({ value: 'stored' });

    const { result } = renderHook(() =>
      usePersistentState(STORAGE_KEY, { schemaVersion: 1, defaultValue: { value: 'default' } as UsePersistentStateOptions<unknown>['defaultValue'] })
    );

    const stored = result.current.getStoredValue();
    expect(stored).toEqual({ value: 'stored' });
  });
});
