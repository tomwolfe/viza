'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// Default vision model (Gemma or Llama vision variant from MLC)
const DEFAULT_MODEL = 'Llama-3.2-11B-Vision-Instruct-q4f16_1-MLC';

export interface DetectedObject {
  name: string;
  bbox_2d: [number, number, number, number]; // [x, y, width, height]
  action: string;
}

export interface VisionResponse {
  objects: DetectedObject[];
  rawText?: string;
}

interface UseWebLLMReturn {
  isModelLoading: boolean;
  modelProgress: number;
  isModelReady: boolean;
  isInferring: boolean;
  initModel: () => Promise<void>;
  runInference: (image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement, prompt: string) => Promise<VisionResponse | null>;
  error: string | null;
}

/**
 * Hook to manage WebLLM worker lifecycle.
 * Handles model loading, inference, and progress reporting.
 */
export function useWebLLM(modelId?: string): UseWebLLMReturn {
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isInferring, setIsInferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const modelIdRef = useRef(modelId || DEFAULT_MODEL);
  const resolveRef = useRef<((value: VisionResponse | null) => void) | null>(null);

  // Initialize the worker and listen to messages
  useEffect(() => {
    // Create worker from public directory
    const worker = new Worker('/worker.js');
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { type, ...data } = event.data;

      switch (type) {
        case 'worker_ready':
          console.log('[WebLLM] Worker ready');
          break;

        case 'init_progress':
          setModelProgress(data.progress || 0);
          setIsModelLoading(true);
          break;

        case 'init_complete':
          setIsModelLoading(false);
          setIsModelReady(true);
          setModelProgress(100);
          console.log('[WebLLM] Model initialized:', data.model);
          break;

        case 'inference_complete':
          setIsInferring(false);
          if (resolveRef.current) {
            resolveRef.current({
              objects: data.response?.objects || [],
              rawText: data.rawText,
            });
            resolveRef.current = null;
          }
          break;

        case 'error':
          console.error('[WebLLM] Error:', data.message);
          setError(data.message);
          setIsModelLoading(false);
          setIsInferring(false);
          if (resolveRef.current) {
            resolveRef.current(null);
            resolveRef.current = null;
          }
          break;

        case 'warning':
          console.warn('[WebLLM] Warning:', data.message);
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
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  /**
   * Initialize the model (triggers download from HuggingFace CDN).
   */
  const initModel = useCallback(async () => {
    if (!workerRef.current) {
      setError('Worker not initialized');
      return;
    }

    setIsModelLoading(true);
    setModelProgress(0);
    setError(null);

    workerRef.current.postMessage({
      type: 'init',
      model: modelIdRef.current,
    });
  }, []);

  /**
   * Run vision inference with an image and user prompt.
   * Returns parsed JSON response or null on error.
   */
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

      // Create a promise that resolves when inference completes
      const result = new Promise<VisionResponse | null>((resolve) => {
        resolveRef.current = resolve;

        // Transfer image to worker
        // For video/canvas elements, we need to convert to ImageBitmap
        const imageSource: ImageBitmap | typeof image = image;

        workerRef.current!.postMessage(
          {
            type: 'chat',
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

  return {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    initModel,
    runInference,
    error,
  };
}
