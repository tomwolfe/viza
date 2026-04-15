/**
 * Type-safe worker message definitions for WebLLM communication.
 */

export type WorkerOutgoingMessage =
  | { type: 'init'; model: string; systemPrompt?: string }
  | { type: 'chat'; image: ImageBitmap; prompt: string; messageId: string }
  | { type: 'reload' }
  | { type: 'ping' }
  | { type: 'app_reset' };

export type WorkerIncomingMessage =
  | { type: 'worker_ready' }
  | { type: 'init_progress'; progress: number; status: string; details?: unknown }
  | { type: 'init_complete'; model: string; progress: number }
  | { type: 'inference_start' }
  | { type: 'inference_complete'; messageId: string; response: unknown; rawText?: string; usage?: unknown }
  | { type: 'error'; message: string; messageId?: string; error?: string }
  | { type: 'warning'; message: string; rawResponse?: string }
  | { type: 'pong' }
  | { type: 'reloaded' }
  | { type: 'unknown_message'; received: string };

export type WorkerMessageType = WorkerIncomingMessage['type'];

export interface VizaError extends Error {
  code: VizaErrorCode;
}

export type VizaErrorCode =
  | 'WEBGPU_NOT_SUPPORTED'
  | 'WORKER_INIT_FAILED'
  | 'INFERENCE_TIMEOUT'
  | 'MODEL_NOT_READY'
  | 'WORKER_CRASHED'
  | 'INVALID_RESPONSE'
  | 'CAMERA_NOT_ALLOWED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_XR_UNAVAILABLE';

export function createVizaError(message: string, code: VizaErrorCode): VizaError {
  const error = new Error(message) as VizaError;
  error.code = code;
  return error;
}