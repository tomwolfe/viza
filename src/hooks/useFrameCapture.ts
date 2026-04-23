'use client';

import { useCallback } from 'react';
import { captureVideoFrame } from '@/utils/frameCapture';

export function useFrameCapture() {
  const captureFrame = useCallback(async (video: HTMLVideoElement | null): Promise<ImageBitmap | null> => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    return captureVideoFrame(video);
  }, []);

  return { captureFrame };
}