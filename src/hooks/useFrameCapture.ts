'use client';

import { MediaProcessor } from '@/utils/frameCapture';

export function useFrameCapture() {
  const captureFrame = async (video: HTMLVideoElement | null): Promise<ImageBitmap | null> => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    return MediaProcessor.captureVideoFrame(video);
  };

  return { captureFrame };
}