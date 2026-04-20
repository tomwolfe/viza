'use client';

import { useRef, useState, useCallback } from 'react';
import { logger, CONFIG } from '@/config';

export interface TelemetryMetrics {
  captureTime: number;
  inferenceTime: number;
  processingTime: number;
}

export interface TelemetryData extends TelemetryMetrics {
  skipCount: number;
}

interface InferenceBuffer {
  samples: number[];
  avgInferenceTime: number;
  adjustedInterval: number;
}

interface UseInferenceAnalyticsOptions {
  intervalMs: number;
  maxBufferSize?: number;
  adjustmentThreshold?: number;
  adjustmentStepMs?: number;
  minInterval?: number;
  maxInterval?: number;
}

export function useInferenceAnalytics({
  intervalMs,
  maxBufferSize = CONFIG.INFERENCE.MAX_BUFFER_SIZE,
  adjustmentThreshold = CONFIG.INFERENCE.ADJUSTMENT_THRESHOLD,
  adjustmentStepMs = CONFIG.INFERENCE.ADJUSTMENT_STEP_MS,
  minInterval = CONFIG.INFERENCE.MIN_INTERVAL,
  maxInterval = CONFIG.INFERENCE.MAX_INTERVAL,
}: UseInferenceAnalyticsOptions) {
  const [adjustedInterval, setAdjustedInterval] = useState(intervalMs);
  const [lastTelemetry, setLastTelemetry] = useState<TelemetryData>({
    captureTime: 0,
    inferenceTime: 0,
    processingTime: 0,
    skipCount: 0,
  });

  const skipCountRef = useRef(0);
  const frameCountRef = useRef(0);
  const inferenceBufferRef = useRef<InferenceBuffer>({
    samples: [],
    avgInferenceTime: 0,
    adjustedInterval: intervalMs,
  });

  const recordSkip = useCallback(() => {
    skipCountRef.current += 1;
  }, []);

  const recordMetrics = useCallback((metrics: TelemetryMetrics) => {
    frameCountRef.current += 1;

    // Update Inference Buffer and Interval
    const buffer = inferenceBufferRef.current;
    buffer.samples.push(metrics.processingTime);
    if (buffer.samples.length > maxBufferSize) {
      buffer.samples.shift();
    }

    if (buffer.samples.length >= maxBufferSize) {
      const sum = buffer.samples.reduce((a, b) => a + b, 0);
      const avg = sum / buffer.samples.length;
      buffer.avgInferenceTime = avg;

      if (avg > buffer.adjustedInterval * adjustmentThreshold) {
        const newInterval = Math.min(maxInterval, buffer.adjustedInterval + adjustmentStepMs);
        if (newInterval !== buffer.adjustedInterval) {
          buffer.adjustedInterval = newInterval;
          setAdjustedInterval(newInterval);
        }
      }
    }

    // Update Telemetry
    if (CONFIG.ENABLE_TELEMETRY && frameCountRef.current % CONFIG.INFERENCE.TELEMETRY_SAMPLE_RATE === 0) {
      const telemetry: TelemetryData = {
        ...metrics,
        skipCount: skipCountRef.current,
      };
      setLastTelemetry(telemetry);
      logger.debug('[Telemetry]', {
        captureTime: `${metrics.captureTime.toFixed(1)}ms`,
        inferenceTime: `${metrics.inferenceTime.toFixed(1)}ms`,
        processingTime: `${metrics.processingTime.toFixed(1)}ms`,
        skipCount: skipCountRef.current,
        avgInferenceTime: `${buffer.avgInferenceTime.toFixed(1)}ms`,
        currentInterval: `${buffer.adjustedInterval}ms`,
      });
    }
  }, [maxBufferSize, adjustmentThreshold, maxInterval, adjustmentStepMs]);

  const reset = useCallback(() => {
    skipCountRef.current = 0;
    frameCountRef.current = 0;
    inferenceBufferRef.current = {
      samples: [],
      avgInferenceTime: 0,
      adjustedInterval: intervalMs,
    };
    setAdjustedInterval(intervalMs);
  }, [intervalMs]);

  return {
    adjustedInterval,
    lastTelemetry,
    recordMetrics,
    recordSkip,
    reset,
  };
}
