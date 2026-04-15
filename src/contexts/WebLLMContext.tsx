'use client';

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import type { VisionResponse } from '@/schemas/vision';
import { checkWebGPU, CONFIG } from '@/config';
import { parseVisionResponse } from '@/schemas/vision';

export interface WebLLMContextValue {
  isModelLoading: boolean;
  modelProgress: number;
  isModelReady: boolean;
  isInferring: boolean;
  isDeviceCompatible: boolean;
  initModel: () => Promise<void>;
  runInference: (image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement, prompt: string) => Promise<VisionResponse | null>;
  error: string | null;
}

const WebLLMContext = createContext<WebLLMContextValue | null>(null);

interface WebLLMProviderProps {
  children: ReactNode;
  modelId?: string;
}

export function WebLLMProvider({ children, modelId }: WebLLMProviderProps) {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isInferring, setIsInferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeviceCompatible, setIsDeviceCompatible] = useState(true);

  const workerRef = useRef<Worker | null>(null);
  const modelIdRef = useRef(modelId || CONFIG.DEFAULT_MODEL);
  const pendingRef = useRef<Map<string, (value: VisionResponse | null) => void>>(new Map());
  const isInitializedRef = useRef(false);

  useEffect(() => {
    checkWebGPU().then((result) => {
      if (!result.supported || result.memoryGB < 4) {
        setIsDeviceCompatible(false);
        setError('WebGPU not supported or insufficient memory (requires 4GB+).');
      }
    });
  }, []);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const worker = new Worker('/worker.js');
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { type, ...data } = event.data;

      switch (type) {
        case 'worker_ready':
          break;

        case 'init_progress':
          setModelProgress(data.progress || 0);
          setIsModelLoading(true);
          break;

        case 'init_complete':
          setIsModelLoading(false);
          setIsModelReady(true);
          setModelProgress(100);
          break;

        case 'inference_complete':
          setIsInferring(false);
          if (data.messageId) {
            const resolve = pendingRef.current.get(data.messageId);
            if (resolve) {
              const validated = parseVisionResponse(data.response);
              if (validated) {
                resolve(validated);
              } else {
                resolve(null);
                setError('Invalid response schema from worker');
              }
              pendingRef.current.delete(data.messageId);
            }
          }
          break;

        case 'error':
          console.error('[WebLLM] Error:', data.message);
          setError(data.message);
          setIsModelLoading(false);
          setIsInferring(false);
          if (data.messageId) {
            const resolve = pendingRef.current.get(data.messageId);
            if (resolve) {
              resolve(null);
              pendingRef.current.delete(data.messageId);
            }
          }
          break;

        case 'warning':
          break;

        default:
          break;
      }
    };

    worker.onerror = (errorEvent) => {
      console.error('[WebLLM] Worker error:', errorEvent);
      setError(`Worker error: ${errorEvent.message}`);
      setIsModelLoading(false);
      setIsInferring(false);
    };

    return () => {
      // NO worker.terminate() here - worker persists across navigation
    };
  }, []);

  const initModel = useCallback(async () => {
    if (!workerRef.current) {
      setError('Worker not initialized');
      return;
    }

    if (!isDeviceCompatible) {
      setError('Device not compatible with WebGPU');
      return;
    }

    setIsModelLoading(true);
    setModelProgress(0);
    setError(null);

    workerRef.current.postMessage({
      type: 'init',
      model: modelIdRef.current,
    });
  }, [isDeviceCompatible]);

  const runInference = useCallback(
    async (
      image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement,
      prompt: string
    ): Promise<VisionResponse | null> => {
      if (!workerRef.current || !isModelReady) {
        setError('Model not ready. Call initModel first.');
        return null;
      }

      setIsInferring(true);
      setError(null);

      const messageId = crypto.randomUUID();

      const result = new Promise<VisionResponse | null>((resolve) => {
        pendingRef.current.set(messageId, resolve);

        const imageSource: ImageBitmap | typeof image = image;

        workerRef.current!.postMessage(
          {
            type: 'chat',
            messageId,
            image: imageSource,
            prompt,
          },
          imageSource instanceof ImageBitmap ? [imageSource] : []
        );
      });

      return result;
    },
    [isModelReady]
  );

  return (
    <WebLLMContext.Provider
      value={{
        isModelLoading,
        modelProgress,
        isModelReady,
        isInferring,
        isDeviceCompatible,
        initModel,
        runInference,
        error,
      }}
    >
      {children}
    </WebLLMContext.Provider>
  );
}

export function useWebLLM(): WebLLMContextValue {
  const context = useContext(WebLLMContext);
  if (!context) {
    throw new Error('useWebLLM must be used within a WebLLMProvider');
  }
  return context;
}