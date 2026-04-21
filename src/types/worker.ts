/**
 * Type-safe worker message definitions for WebLLM communication.
 */

export type WorkerOutgoingMessage =
  | { type: 'init'; model: string; systemPrompt?: string }
  | { type: 'chat'; image: ImageBitmap; prompt: string; messageId: string; worldMapContext?: { name: string; x: number; y: number; z: number }[] }
  | { type: 'planning'; image: ImageBitmap; goal: string; messageId: string; worldMapContext?: { name: string; x: number; y: number; z: number }[] }
  | { type: 'correction'; image: ImageBitmap; analysis: string; originalStepIndex: number; messageId: string; worldMapContext?: { name: string; x: number; y: number; z: number }[] }
  | { type: 'category'; image: ImageBitmap; goal: string; messageId: string; worldMapContext?: { name: string; x: number; y: number; z: number }[] }
  | { type: 'verification'; image: ImageBitmap; validationPrompt: string; targetObject: string; messageId: string; worldMapContext?: { name: string; x: number; y: number; z: number }[] }
  | { type: 'reload' }
  | { type: 'soft_reload'; model: string; systemPrompt?: string }
  | { type: 'ping' }
  | { type: 'app_reset' };

export type WorkerIncomingMessage =
  | { type: 'worker_ready' }
  | { type: 'init_progress'; progress: number; status: string; details?: unknown }
  | { type: 'init_complete'; model: string; progress: number; cacheStatus?: 'cache' | 'indexeddb' | 'already_loaded' }
  | { type: 'inference_start' }
  | { type: 'inference_complete'; messageId: string; response: unknown; completed?: boolean; rawText?: string; usage?: unknown; spatialContext?: string }
  | { type: 'planning_complete'; messageId: string; response: unknown; rawText?: string; usage?: unknown }
  | { type: 'correction_complete'; messageId: string; response: unknown; analysis: string; rawText?: string }
  | { type: 'verification_complete'; messageId: string; isCompleted: boolean; confidence: number; rawText?: string; usage?: unknown }
  | { type: 'error'; message: string; messageId?: string; error?: string; errorCode: VizaErrorCode }
  | { type: 'warning'; message: string; rawResponse?: string }
  | { type: 'pong' }
  | { type: 'reloaded' }
  | { type: 'reset_ack' }
  | { type: 'unknown_message'; received: string };

export type WorkerMessageType = WorkerIncomingMessage['type'];

export interface VizaError extends Error {
  code: VizaErrorCode;
}

export type VizaErrorCode =
  | 'WEBGPU_NOT_SUPPORTED'
  | 'WORKER_INIT_FAILED'
  | 'INFERENCE_TIMEOUT'
  | 'INFERENCE_ERROR'
  | 'MODEL_NOT_READY'
  | 'WORKER_CRASHED'
  | 'INVALID_RESPONSE'
  | 'CAMERA_NOT_ALLOWED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_XR_UNAVAILABLE'
  | 'NO_SPEECH_DETECTED'
  | 'MICROPHONE_NOT_FOUND'
  | 'MICROPHONE_NOT_ALLOWED'
  | 'VOICE_ERROR';

export function createVizaError(message: string, code: VizaErrorCode): VizaError {
  const error = new Error(message) as VizaError;
  error.code = code;
  return error;
}

export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };