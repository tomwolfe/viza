/**
 * Centralized configuration for Viza AR application.
 * Single source of truth for all tunable parameters.
 */

export const CONFIG = {
  DEFAULT_MODEL: 'Llama-3.2-11B-Vision-Instruct-q4f16_1-MLC',
  TARGET_SIZE: 512,
  INFERENCE_INTERVAL: 5000,
  ENABLE_TELEMETRY: process.env.NODE_ENV === 'development',

  SPATIAL: {
    TARGET_SIZE: 512,
    DEFAULT_DEPTH: -3,
    DEPTH_INCREMENT: 0.5,
    LABEL_OFFSET: 0.15,
    ACTION_OFFSET: 0.3,
    BOX_COLOR: '#00ff88',
    LABEL_BG_COLOR: '#000000',
    LABEL_BG_OPACITY: 0.7,
    FONT_SIZE: 0.12,
    ACTION_FONT_SIZE: 0.08,
    OUTLINE_WIDTH: 0.02,
    ACTION_OUTLINE_WIDTH: 0.01,
  },
};

export const SYSTEM_PROMPT_BASE = `You are a spatial assistant for assembly tasks. Analyze this image based on the user's audio request.
Current Task Context: {taskContext}
Current Step: {currentStep}
Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "name": "string",
      "bbox_2d": [x, y, width, height],
      "action": "string"
    }
  ],
  "completed": boolean,
  "nextStep": "string | null"
}
Do not include any other text. Only return the JSON object.`;

export function buildSystemPrompt(taskContext: string, currentStep: string): string {
  return SYSTEM_PROMPT_BASE
    .replace('{taskContext}', taskContext)
    .replace('{currentStep}', currentStep);
}

export const SYSTEM_PROMPT = `You are a spatial assistant. Analyze this image based on the user's audio request. 
Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "name": "string",
      "bbox_2d": [x, y, width, height],
      "action": "string"
    }
  ]
}
Do not include any other text. Only return the JSON object.`;

export async function checkWebGPU() {
  const result = { supported: false, memoryGB: 0 };
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return result;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return result;
    }

    const device = await adapter.requestDevice();
    const totalMemory = device.limits?.maxStorageBufferBindingSize || 0;
    const memoryGB = Math.floor(totalMemory / (1024 * 1024 * 1024));

    if (memoryGB >= 4) {
      return { supported: true, memoryGB };
    }

    return { supported: true, memoryGB };
  } catch {
    return { supported: false, memoryGB: 0 };
  }
}

export const logger = {
  log: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.log('[Viza]', ...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.warn('[Viza]', ...args);
    }
  },
  error: (...args: unknown[]) => {
    console.error('[Viza]', ...args);
  },
};