'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { VizaErrorCode } from '@/types/worker';
import { getErrorMessage } from '@/constants/errors';
import { logger } from '@/config';

interface VizaErrorState {
  code: VizaErrorCode | null;
  message: string | null;
  originalError: unknown | null;
}

interface VizaErrorContextValue {
  error: VizaErrorState;
  setError: (_code: VizaErrorCode, _originalError?: unknown) => void;
  clearError: () => void;
  unifiedError: string | null;
  unifiedErrorCode: VizaErrorCode | null;
}

const VizaErrorContext = createContext<VizaErrorContextValue | null>(null);

export function VizaErrorProvider({ children }: { children: React.ReactNode }) {
  const [errorState, setErrorState] = useState<VizaErrorState>({
    code: null,
    message: null,
    originalError: null,
  });

  const setError = useCallback((code: VizaErrorCode, originalError?: unknown) => {
    const message = getErrorMessage(code);
    logger.error(`[VizaError] ${code}: ${message}`, originalError);
    setErrorState({
      code,
      message,
      originalError: originalError || null,
    });
  }, []);

  const clearError = useCallback(() => {
    setErrorState({
      code: null,
      message: null,
      originalError: null,
    });
  }, []);

  const value = useMemo(() => ({
    error: errorState,
    setError,
    clearError,
    unifiedError: errorState.message,
    unifiedErrorCode: errorState.code,
  }), [errorState, setError, clearError]);

  return (
    <VizaErrorContext.Provider value={value}>
      {children}
    </VizaErrorContext.Provider>
  );
}

export function useVizaError() {
  const context = useContext(VizaErrorContext);
  if (!context) {
    throw new Error('useVizaError must be used within a VizaErrorProvider');
  }
  return context;
}
