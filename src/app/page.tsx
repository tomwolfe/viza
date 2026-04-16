'use client';

import { WebLLMProvider } from '@/contexts/WebLLMContext';
import { ARContent } from '@/components/ARContent';

export default function Home() {
  return (
    <WebLLMProvider>
      <ARContent />
    </WebLLMProvider>
  );
}