'use client';

import { captureVideoFrame } from '@/utils/frameCapture';

export function useFrameCapture() {
  const captureFrame = async (video: HTMLVideoElement | null): Promise<ImageBitmap | null> => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    return captureVideoFrame(video);
  };

  return { captureFrame };
}