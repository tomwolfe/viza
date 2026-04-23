export const CONFIG = {
  DEFAULT_MODEL: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
  MODEL_SIZE_GB: 2.3,
  TARGET_SIZE: 512,
  INFERENCE_INTERVAL: 4000,
  INFERENCE_TIMEOUT_MS: 15000,
  PLANNING_TIMEOUT_MS: 30000,
  INITIALIZATION_TIMEOUT_MS: 300000,
  ENABLE_TELEMETRY: process.env.NODE_ENV === 'development',
  USE_INDEXED_DB_CACHE: true,
  SHOW_MODEL_CACHE_HINT: true,

  INFERENCE: {
    MAX_BUFFER_SIZE: 5,
    ADJUSTMENT_THRESHOLD: 0.7,
    ADJUSTMENT_STEP_MS: 1000,
    MIN_INTERVAL: 500,
    MAX_INTERVAL: 10000,
    TELEMETRY_SAMPLE_RATE: 10,
  },

  SPATIAL: {
    TARGET_SIZE: 512,
    DEFAULT_DEPTH: -3,
    DEPTH_INCREMENT: 0.5,
    GROUND_PLANE_Y: -1.5,
    LABEL_OFFSET: 0.15,
    ACTION_OFFSET: 0.3,
    HIT_TEST_OFFSET: 0.3,
    GROUND_PROJECTION_OFFSET: 0.3,
    HIGHLIGHTER_CONE_WIDTH: 0.15,
    HIGHLIGHTER_CONE_HEIGHT: 0.4,
    HIGHLIGHTER_OFFSET: 0.3,
    LABEL_ZDEPTH: 0.01,
    LABEL_TEXT_ZDEPTH: 0.02,
    BOX_COLOR: '#00ff88',
    BOX_OPACITY: 0.15,
    HIGHLIGHT_OPACITY: 0.3,
    GHOST_OPACITY: 0.1,
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
    SAVE_DELAY_MS: 500,
    ONE_EURO: {
      MIN_CUTOFF: 0.5,
      BETA: 0.7,
      DCUTOFF: 1.0,
      VELOCITY_THRESHOLD: 0.5,
      STATIC_PRECISION: 0.3,
      DYNAMIC_SMOOTHING: 1.5,
    },
    FOV_RADIUS: 5,
    STALE_THRESHOLD_MS: 3000,
  },

  VERIFICATION: {
    CONSECUTIVE_DETECTIONS: 3,
    CONFIDENCE_THRESHOLD: 0.7,
    REMOVAL_VERIFICATION_FRAMES: 5,
    PLACEMENT_VERIFICATION_FRAMES: 3,
    DEBOUNCE_MS: 2000,
    TIMEOUT_MS: 60000,
  },

  MATCHING: {
    LABEL_WEIGHT: 0.4,
    DISTANCE_WEIGHT: 0.35,
    RECENCY_WEIGHT: 0.25,
    CONFIDENCE_WEIGHT: 0.3,
    MIN_MATCH_SCORE: 0.5,
  },

  CATEGORIES: {
    TRASH: { color: '#ff4444', label: 'Trash', keywords: ['trash', 'garbage', 'waste', 'paper', 'bottle', 'can', 'wrapper', 'discard'] },
    CLUTTER: { color: '#ffaa00', label: 'Clutter', keywords: ['mess', 'clothes', 'cloth', 'pile', 'scattered', 'untidy', 'organize'] },
    KEEP: { color: '#44ff44', label: 'Keep', keywords: ['keep', 'save', 'important', 'valuable'] },
    TOOL: { color: '#4488ff', label: 'Tool', keywords: ['screwdriver', 'wrench', 'hammer', 'driver', 'pliers', 'saw', 'tool'] },
  },

  DIRECTIONAL_INDICATOR: {
    EDGE_MARGIN: 60,
    ARROW_SIZE: 24,
    MAX_BREADCRUMBS: 10,
    BREADCRUMB_INTERVAL_MS: 2000,
    GHOST_OPACITY: 0.3,
    GHOST_DISTANCE_THRESHOLD: 10,
  },
};

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
    result.issues.push('WebGPU not supported by this browser.');
    return result;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      result.issues.push('No GPU adapter found.');
      return result;
    }

    // If we have an adapter, we consider it supported.
    // WebLLM will request specific limits (like maxStorageBufferBindingSize)
    // internally when it creates its own device.
    result.supported = true;
    result.isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    
    return result;
  } catch (error) {
    result.issues.push(`WebGPU check failed: ${(error as Error).message}`);
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
