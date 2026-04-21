'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[Viza] Service Worker registered:', registration.scope);
        })
        .catch((error) => {
          console.error('[Viza] Service Worker registration failed:', error);
        });
    }
  }, []);

  return null;
}