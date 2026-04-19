import type { VizaErrorCode } from '@/types/worker';

export interface ParsedError {
  code: VizaErrorCode;
  message: string;
}

export function parseMediaError(err: unknown): ParsedError {
  const domErr = err as DOMException;
  if (domErr.name === 'NotAllowedError') {
    return {
      code: 'CAMERA_NOT_ALLOWED' as VizaErrorCode,
      message: 'Camera access denied. Please allow camera permissions in your browser settings.',
    };
  }
  if (domErr.name === 'NotFoundError') {
    return {
      code: 'CAMERA_NOT_FOUND' as VizaErrorCode,
      message: 'No camera found. Please connect a camera and try again.',
    };
  }
  return {
    code: 'CAMERA_XR_UNAVAILABLE' as VizaErrorCode,
    message: err instanceof Error ? err.message : 'Unknown camera error',
  };
}

export function parseXRError(err: unknown): ParsedError {
  const errMessage = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  
  if (errMessage.includes('not available') || errMessage.includes('unavailable')) {
    return {
      code: 'CAMERA_XR_UNAVAILABLE' as VizaErrorCode,
      message: 'WebXR is not available on this device.',
    };
  }
  
  const domErr = err as DOMException;
  if (domErr.name === 'NotAllowedError') {
    return {
      code: 'CAMERA_NOT_ALLOWED' as VizaErrorCode,
      message: 'XR permission denied.',
    };
  }
  
  return {
    code: 'CAMERA_XR_UNAVAILABLE' as VizaErrorCode,
    message: err instanceof Error ? err.message : 'Unknown XR error',
  };
}

export function parseLLMError(err: unknown): ParsedError {
  const errMessage = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  
  if (errMessage.includes('timeout')) return { code: 'INFERENCE_TIMEOUT' as VizaErrorCode, message: 'Inference timed out.' };
  if (errMessage.includes('memory') || errMessage.includes('gpu')) return { code: 'WEBGPU_NOT_SUPPORTED' as VizaErrorCode, message: 'WebGPU or sufficient memory not available.' };
  if (errMessage.includes('model') || errMessage.includes('engine')) return { code: 'MODEL_NOT_READY' as VizaErrorCode, message: 'Model engine not ready.' };
  if (errMessage.includes('parse') || errMessage.includes('json')) return { code: 'INVALID_RESPONSE' as VizaErrorCode, message: 'Invalid response from model.' };
  
  return { code: 'INFERENCE_ERROR' as VizaErrorCode, message: err instanceof Error ? err.message : 'Unknown LLM error' };
}

export function parseSystemError(err: unknown, context: 'media' | 'xr' | 'llm'): ParsedError {
  switch (context) {
    case 'media':
      return parseMediaError(err);
    case 'xr':
      return parseXRError(err);
    case 'llm':
      return parseLLMError(err);
  }
}
