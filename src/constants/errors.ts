import type { VizaErrorCode } from '@/types/worker';

export const ERROR_MESSAGES: Record<VizaErrorCode, string> = {
  WEBGPU_NOT_SUPPORTED: 'Please use a WebGPU-capable browser (Chrome 113+, Edge 113+) on a compatible device.',
  CAMERA_NOT_ALLOWED: 'Camera access denied. Please allow camera permissions in your browser settings.',
  CAMERA_NOT_FOUND: 'No camera found. Please connect a camera and try again.',
  CAMERA_XR_UNAVAILABLE: 'WebXR is not available on this device.',
  MICROPHONE_NOT_ALLOWED: 'Microphone permission denied. Please allow microphone access in your browser settings.',
  MICROPHONE_NOT_FOUND: 'No microphone found. Please connect a microphone to your device.',
  NO_SPEECH_DETECTED: 'No speech detected. Please try again.',
  VOICE_ERROR: 'Speech recognition error. Check connection or try again later.',
  MODEL_INIT_FAILED: 'Model initialization timed out. This usually means the 2.3GB model download is taking too long. Try on a faster connection.',
  WORKER_INIT_FAILED: 'Failed to initialize AI worker. Please refresh and try again.',
  WORKER_CRASHED: 'AI worker crashed. Please refresh the page.',
  INFERENCE_TIMEOUT: 'AI processing timed out. Please try again.',
  INFERENCE_ERROR: 'An error occurred during AI processing.',
  MODEL_NOT_READY: 'The AI model is not ready yet.',
  INVALID_RESPONSE: 'Invalid response from AI model.',
};

export const getErrorMessage = (code: VizaErrorCode | null, fallback?: string | null): string | null => {
  if (!code) return fallback || null;
  return ERROR_MESSAGES[code] || fallback || 'An unknown error occurred.';
};
