'use client';

import { ReactNode } from 'react';
import { useVizaOrchestrator } from './VizaOrchestratorContext';

export function SpatialProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useSpatial() {
  return useVizaOrchestrator();
}
