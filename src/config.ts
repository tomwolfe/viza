export const CONFIG = {
  DEFAULT_MODEL: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
  MODEL_SIZE_GB: 2.3,
  TARGET_SIZE: 512,
  INFERENCE_INTERVAL: 4000,
  INFERENCE_TIMEOUT_MS: 15000,
  PLANNING_TIMEOUT_MS: 30000,
  ENABLE_TELEMETRY: process.env.NODE_ENV === 'development',
  USE_INDEXED_DB_CACHE: true,
  SHOW_MODEL_CACHE_HINT: true,

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
    BOX_OPACITY: 0.15,
    HIGHLIGHT_OPACITY: 0.3,
    LABEL_BG_COLOR: '#000000',
    LABEL_BG_OPACITY: 0.7,
    FONT_SIZE: 0.12,
    ACTION_FONT_SIZE: 0.08,
    OUTLINE_WIDTH: 0.02,
    ACTION_OUTLINE_WIDTH: 0.01,
    DISTANCE_THRESHOLD: 0.5,
    DAMPENING_FACTOR: 0.3,
    MIN_BOX_SIZE: 0.1,
    MAX_WORLD_OBJECTS: 100,
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

export interface WebGPUCheckResult {
  supported: boolean;
  memoryGB: number;
  recommendedGB: number;
  isMobile: boolean;
  issues: string[];
}

export async function checkWebGPU(): Promise<WebGPUCheckResult> {
  const result: WebGPUCheckResult = {
    supported: false,
    memoryGB: 0,
    recommendedGB: 8,
    isMobile: false,
    issues: [],
  };

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    result.issues.push('WebGPU not available in browser');
    return result;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      result.issues.push('No GPU adapter found');
      return result;
    }

    const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    result.isMobile = isMobile;

    const device = await adapter.requestDevice();

    const maxStorageBuffer = device.limits.maxStorageBufferBindingSize;
    const maxUniformBuffer = device.limits.maxUniformBufferBindingSize;
    const maxComputeWorkgroupStorage = device.limits.maxComputeWorkgroupStorageSize;

    result.memoryGB = Math.floor(maxStorageBuffer / (1024 * 1024 * 1024));

    if (isMobile) {
      if (maxStorageBuffer < 256 * 1024 * 1024) {
        result.issues.push('Mobile GPU has insufficient storage buffer size (min 256MB required)');
      }
      if (maxComputeWorkgroupStorage < 16 * 1024) {
        result.issues.push('Mobile GPU has insufficient compute shader memory');
      }
    }

    if (maxStorageBuffer < 256 * 1024 * 1024) {
      result.issues.push('Storage buffer binding size below minimum requirement');
    }

    if (maxUniformBuffer < 64 * 1024 * 1024) {
      result.issues.push('Uniform buffer size below recommendation');
    }

    if (result.issues.length === 0) {
      result.supported = true;
    }

    return result;
  } catch (error) {
    result.issues.push(`WebGPU initialization failed: ${(error as Error).message}`);
    return result;
  }
}

export function estimateModelCacheStatus(): { likelyCached: boolean; message: string } {
  if (!CONFIG.SHOW_MODEL_CACHE_HINT) {
    return { likelyCached: false, message: '' };
  }
  
  return {
    likelyCached: CONFIG.USE_INDEXED_DB_CACHE,
    message: CONFIG.USE_INDEXED_DB_CACHE 
      ? `Model will be cached in IndexedDB after first load. Subsequent uses won't require ${CONFIG.MODEL_SIZE_GB}GB download.`
      : `Model uses browser Cache API. May require re-download on subsequent uses.`,
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'trace';

export const logger = {
  debug: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.debug('[Viza:DEBUG]', ...args);
    }
  },
  trace: (...args: unknown[]) => {
    if (CONFIG.ENABLE_TELEMETRY) {
      console.debug('[Viza:TRACE]', ...args);
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