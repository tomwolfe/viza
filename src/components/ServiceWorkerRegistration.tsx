'use client';

import { useEffect, useCallback, useState } from 'react';



export function ServiceWorkerRegistration() {
  const checkOfflineReady = useCallback(() => {
    if (typeof window !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CHECK_OFFLINE_READY' });
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[Viza] Service Worker registered:', registration.scope);
          
          setTimeout(() => {
            checkOfflineReady();
          }, 1000);
        })
        .catch((error) => {
          console.error('[Viza] Service Worker registration failed:', error);
        });

      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        if (event.data && event.data.type === 'OFFLINE_READY_STATUS') {
          console.log('[Viza] Offline ready:', event.data.ready, 'Cache:', event.data.cacheName);
        }
      });
    }
  }, [checkOfflineReady]);

  useEffect(() => {
    const handleOnline = () => {
      checkOfflineReady();
    };
    
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [checkOfflineReady]);

  return null;
}

export function useOfflineReady() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [cacheName, setCacheName] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OFFLINE_READY_STATUS') {
        setOfflineReady(event.data.ready);
        setCacheName(event.data.cacheName);
      }
    };

    navigator.serviceWorker.addEventListener('message', handler);

    navigator.serviceWorker.controller?.postMessage({ type: 'CHECK_OFFLINE_READY' });

    return () => {
      navigator.serviceWorker.removeEventListener('message', handler);
    };
  }, []);

  return { isOfflineReady: offlineReady, cacheName };
}