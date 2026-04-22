'use client';

import { ReactNode } from 'react';
import { useVizaOrchestrator } from './VizaOrchestratorContext';

export function WebLLMProvider({ children }: { children: ReactNode }) {
  // This is now a no-op provider if used inside VizaOrchestratorProvider
  return <>{children}</>;
}

export function useWebLLM() {
  return useVizaOrchestrator();
}
