'use client';

import { WebLLMProvider } from '@/contexts/WebLLMContext';
import { VizaErrorProvider } from '@/contexts/VizaErrorContext';
import { ARContent } from '@/components/ARContent';

export default function Home() {
  return (
    <VizaErrorProvider>
      <WebLLMProvider>
        <ARContent />
      </WebLLMProvider>
    </VizaErrorProvider>
  );
}