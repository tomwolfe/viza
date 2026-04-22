'use client';

import { VizaOrchestratorProvider } from '@/contexts/VizaOrchestratorContext';
import { VizaErrorProvider } from '@/contexts/VizaErrorContext';
import { ARContent } from '@/components/ARContent';

export default function Home() {
  return (
    <VizaErrorProvider>
      <VizaOrchestratorProvider>
        <ARContent />
      </VizaOrchestratorProvider>
    </VizaErrorProvider>
  );
}