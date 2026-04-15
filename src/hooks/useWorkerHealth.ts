'use client';

import { useEffect, useRef, useCallback } from 'react';
import { CONFIG, logger } from '@/config';

const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 60000;

export interface UseWorkerHealthOptions {
  worker: Worker | null;
  isModelReady: boolean;
  onWorkerUnresponsive: () => void;
  onWorkerReady: () => void;
}

export function useWorkerHealth({
  worker,
  isModelReady,
  onWorkerUnresponsive,
  onWorkerReady,
}: UseWorkerHealthOptions) {
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef<number>(0);
  const reconnectAttemptRef = useRef<number>(0);

  const startHeartbeat = useCallback(() => {
    if (!worker) return;

    heartbeatRef.current = setInterval(() => {
      const timeSinceLastPong = Date.now() - lastPongRef.current;

      if (timeSinceLastPong > HEARTBEAT_TIMEOUT_MS) {
        logger.warn('[useWorkerHealth] Worker unresponsive, attempting reconnect...');
        onWorkerUnresponsive();
        reconnectAttemptRef.current += 1;

        if (reconnectAttemptRef.current <= 3) {
          setTimeout(() => {
            onWorkerReady();
          }, 1000);
        }
        return;
      }

      worker.postMessage({ type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }, [worker, onWorkerUnresponsive, onWorkerReady]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const handlePong = useCallback(() => {
    lastPongRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!worker || !isModelReady) {
      stopHeartbeat();
      return;
    }

    startHeartbeat();

    return () => {
      stopHeartbeat();
    };
  }, [worker, isModelReady, startHeartbeat, stopHeartbeat]);

  return {
    handlePong,
    stopHeartbeat,
  };
}