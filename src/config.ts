/**
 * Centralized configuration for Viza AR application.
 * Single source of truth for all tunable parameters.
 */

export const CONFIG = {
  DEFAULT_MODEL: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
  MODEL_SIZE_GB: 2.3,
  TARGET_SIZE: 512,
  INFERENCE_INTERVAL: 4000,
  INFERENCE_TIMEOUT_MS: 15000,
  PLANNING_TIMEOUT_MS: 30000,
  ENABLE_TELEMETRY: process.env.NODE_ENV === 'development',

  SPATIAL: {
    TARGET_SIZE: 512,
    DEFAULT_DEPTH: -3,
    DEPTH_INCREMENT: 0.5,
    LABEL_OFFSET: 0.15,
    ACTION_OFFSET: 0.3,
    HIT_TEST_OFFSET: 0.3,
    HIGHLIGHTER_CONE_WIDTH: 0.15,
    HIGHLIGHTER_CONE_HEIGHT: 0.4,
    HIGHLIGHTER_OFFSET: 0.3,
    BOX_COLOR: '#00ff88',
    LABEL_BG_COLOR: '#000000',
    LABEL_BG_OPACITY: 0.7,
    FONT_SIZE: 0.12,
    ACTION_FONT_SIZE: 0.08,
    OUTLINE_WIDTH: 0.02,
    ACTION_OUTLINE_WIDTH: 0.01,
    DISTANCE_THRESHOLD: 0.5,
    DAMPENING_FACTOR: 0.3,
    MIN_BOX_SIZE: 0.1,
    ONE_EURO: {
      MIN_CUTOFF: 0.5,
      BETA: 0.7,
      DCUTOFF: 1.0,
    },
  },

  CATEGORIES: {
    TRASH: { color: '#ff4444', label: 'Trash', keywords: ['trash', 'garbage', 'waste', 'paper', 'bottle', 'can', 'wrapper', 'discard'] },
    CLUTTER: { color: '#ffaa00', label: 'Clutter', keywords: ['mess', 'clothes', 'cloth', 'pile', 'scattered', 'untidy', 'organize'] },
    KEEP: { color: '#44ff44', label: 'Keep', keywords: ['keep', 'save', 'important', 'valuable'] },
    TOOL: { color: '#4488ff', label: 'Tool', keywords: ['screwdriver', 'wrench', 'hammer', 'driver', 'pliers', 'saw', 'tool'] },
  },
};

export const SYSTEM_PROMPT_BASE = `You are a spatial assistant for assembly tasks. Analyze this image based on the user's audio request.
Current Task Context: {taskContext}
Current Step: {currentStep}
Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string",
      "coordinates": [x, y, width, height],
      "action_step": "string"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;

export function buildSystemPrompt(taskContext: string, currentStep: string): string {
  return SYSTEM_PROMPT_BASE
    .replace('{taskContext}', taskContext)
    .replace('{currentStep}', currentStep);
}

export const PromptFactory = {
  vision(): string {
    return `Analyze this scene and identify objects of interest. Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string",
      "coordinates": [x, y, width, height],
      "action_step": "string"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;
  },

  planning(userGoal: string): string {
    const isCleaningMode = /clean|organize|trash|garbage|mess/i.test(userGoal);
    const categoryFocus = isCleaningMode
      ? 'Identify all objects that match the goal category and create a prioritized cleanup plan.'
      : 'Analyze this image and create a detailed task plan for completing this goal.';

    return `You are a spatial planning assistant. The user wants to: "${userGoal}"

${categoryFocus}

Return ONLY a valid JSON object with this structure:
{
  "taskSteps": [
    {
      "id": "step-N",
      "instruction": "Clear description of what to do",
      "targetObject": "The specific object or category to target",
      "validationPrompt": "How to verify this step is complete"
    }
  ]
}

Provide 5-10 specific steps in logical order. Do not include any other text.`;
  },

  category(userGoal: string): string {
    const isTrash = /trash|garbage|discard|throw away|waste/i.test(userGoal);
    const isClutter = /clean|organize|mess|tidy|put away/i.test(userGoal);

    let categoryFocus = '';
    if (isTrash) {
      categoryFocus = 'Identify all TRASH items (wrappers, bottles, cans, paper waste, food containers, etc.) and return their bounding boxes.';
    } else if (isClutter) {
      categoryFocus = 'Identify all CLUTTER items (clothes, papers, scattered items, messy areas) and return their bounding boxes.';
    } else {
      categoryFocus = 'Identify all objects and their categories. Use "keep" for items to preserve, "trash" for waste, "clutter" for items to organize.';
    }

    return `You are a spatial assistant for cleaning tasks.
User Goal: "${userGoal}"

${categoryFocus}

Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string - object name",
      "coordinates": [x, y, width, height],
      "action_step": "string - action to take with this object (e.g., 'throw away', 'keep', 'organize')",
      "category": "string - one of: trash, clutter, keep, tool, unknown"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;
  },
};

export const SYSTEM_PROMPT = `You are a spatial assistant. Analyze this image based on the user's audio request. 
Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string",
      "coordinates": [x, y, width, height],
      "action_step": "string"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;

export function getVisionPrompt(): string {
  return PromptFactory.vision();
}

export function getPlanningPrompt(userGoal: string): string {
  return PromptFactory.planning(userGoal);
}

export function getCategoryPrompt(userGoal: string): string {
  return PromptFactory.category(userGoal);
}

export async function checkWebGPU() {
  const result = { supported: false, memoryGB: 0, recommendedGB: 8 };
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

    if (memoryGB >= 8) {
      return { supported: true, memoryGB, recommendedGB: 8 };
    }

    return { supported: true, memoryGB, recommendedGB: 8 };
  } catch {
    return { supported: false, memoryGB: 0, recommendedGB: 8 };
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const logger = {
  debug: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.debug('[Viza:DEBUG]', ...args);
    }
  },
  info: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.log('[Viza:INFO]', ...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.warn('[Viza:WARN]', ...args);
    }
  },
  error: (...args: unknown[]) => {
    console.error('[Viza:ERROR]', ...args);
  },
  log: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.log('[Viza]', ...args);
    }
  },
};