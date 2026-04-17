'use client';

import { useCallback } from 'react';

export function useVoiceIntent() {
  const isCleaningIntent = useCallback((transcript: string) => {
    return /clean|organize|trash|garbage|mess|fix|help/i.test(transcript);
  }, []);

  return {
    isCleaningIntent,
  };
}
