'use client';

import { useCallback } from 'react';

export function useVoiceIntent() {
  const isCleaningIntent = useCallback((transcript: string) => {
    return /clean|organize|trash|garbage|mess|fix|help/i.test(transcript);
  }, []);

  const isNavigationIntent = useCallback((transcript: string) => {
    return /go to|where is|find/i.test(transcript);
  }, []);

  return {
    isCleaningIntent,
    isNavigationIntent,
  };
}
