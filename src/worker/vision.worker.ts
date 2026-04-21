import * as webllm from '@mlc-ai/web-llm';
import { z } from 'zod';
import type { WorkerOutgoingMessage, WorkerIncomingMessage, VizaErrorCode } from '@/types/worker';
import { CONFIG, logger } from '@/config';
import { extractJsonFromText, parseJsonResponse } from '@/utils/responseParser';
import { TASK_CONFIGS, PromptFactory, type TaskRunnerConfig } from '@/services/promptManager';
import { VisionResponseSchema, PlanningResponseSchema } from '@/schemas/vision';

function hasImage(msg: WorkerOutgoingMessage): msg is Extract<WorkerOutgoingMessage, { image: ImageBitmap }> {
  return 'image' in msg;
}

function sendError(messageId: string, message: string, code: VizaErrorCode, error?: Error): void {
  postMessage({
    type: 'error',
    messageId,
    message,
    error: error?.toString(),
    errorCode: code,
  });
}

function mapErrorToCode(error: unknown): VizaErrorCode {
  const err = error as Error;
  const message = err.message?.toLowerCase() ?? '';
  
  if (message.includes('timeout')) return 'INFERENCE_TIMEOUT';
  if (message.includes('memory') || message.includes('gpu')) return 'WEBGPU_NOT_SUPPORTED';
  if (message.includes('model') || message.includes('engine')) return 'MODEL_NOT_READY';
  if (message.includes('parse') || message.includes('json')) return 'INVALID_RESPONSE';
  
  return 'INFERENCE_ERROR';
}

function validateImage(msg: WorkerOutgoingMessage): boolean {
  if (!hasImage(msg)) {
    return false;
  }
  const typedMsg = msg as Extract<WorkerOutgoingMessage, { image: ImageBitmap }>;
  if (!typedMsg.image) {
    sendError(typedMsg.messageId, `Missing image for ${msg.type}`, 'WORKER_INIT_FAILED');
    return false;
  }
  return true;
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as WorkerOutgoingMessage;

  switch (msg.type) {
    case 'init':
      if (msg.systemPrompt) {
        workerState.systemPrompt = msg.systemPrompt;
      }
      await initializeModel(msg.model || CONFIG.DEFAULT_MODEL);
      break;

    case 'chat':
      if (validateImage(msg)) {
        await runTask(msg.image!, msg.prompt, msg.messageId, TASK_CONFIGS['chat'], msg.worldMapContext);
      }
      break;

    case 'planning':
      if (validateImage(msg)) {
        await runTask(msg.image!, msg.goal, msg.messageId, TASK_CONFIGS['planning'], msg.worldMapContext);
      }
      break;

    case 'category':
      if (validateImage(msg)) {
        await runTask(msg.image!, msg.goal, msg.messageId, TASK_CONFIGS['category'], msg.worldMapContext);
      }
      break;

    case 'reload':
      await reloadEngine();
      break;

    case 'soft_reload':
      await softReloadEngine(msg.model, msg.systemPrompt);
      break;

    case 'app_reset':
      postMessage({ type: 'reset_ack' });
      break;

    case 'ping':
      postMessage({ type: 'pong' });
      break;

    default:
      sendError('', `Unknown message type: ${(msg as any).type}`, 'WORKER_INIT_FAILED');
      break;
  }
};

interface WorkerState {
  engine: webllm.MLCEngine | null;
  isInitialized: boolean;
  currentModel: string | null;
  systemPrompt: string;
}

interface DetectionMemory {
  objects: {
    name: string;
    position: { x: number; y: number; z: number };
    timestamp: number;
    category: string;
  }[];
  lastUpdate: number;
}

const DETECTION_MEMORY_SIZE = 10;
const MEMORY_RETENTION_MS = 60000;

const detectionMemory: DetectionMemory = {
  objects: [],
  lastUpdate: 0,
};

function updateDetectionMemory(
  objects: { name: string; position: { x: number; y: number; z: number }; category?: string }[]
): void {
  const now = performance.now();

  for (const obj of objects) {
    const existingIndex = detectionMemory.objects.findIndex(
      m => m.name.toLowerCase() === obj.name.toLowerCase()
    );

    if (existingIndex >= 0) {
      detectionMemory.objects[existingIndex] = {
        name: obj.name,
        position: obj.position,
        timestamp: now,
        category: obj.category || 'unknown',
      };
    } else {
      detectionMemory.objects.unshift({
        name: obj.name,
        position: obj.position,
        timestamp: now,
        category: obj.category || 'unknown',
      });
    }
  }

  if (detectionMemory.objects.length > DETECTION_MEMORY_SIZE) {
    detectionMemory.objects = detectionMemory.objects.slice(0, DETECTION_MEMORY_SIZE);
  }

  detectionMemory.lastUpdate = now;
}

function getSpatialContext(): string {
  const now = performance.now();
  const recentObjects = detectionMemory.objects.filter(
    obj => now - obj.timestamp < MEMORY_RETENTION_MS
  );

  if (recentObjects.length === 0) {
    return '';
  }

  const contextParts: string[] = ['Recent detections for spatial reference:'];

  for (let i = 0; i < Math.min(3, recentObjects.length); i++) {
    const obj = recentObjects[i];
    const refs: string[] = [];

    for (let j = 0; j < recentObjects.length; j++) {
      if (i === j) continue;
      const other = recentObjects[j];
      const dx = obj.position.x - other.position.x;
      const dy = obj.position.y - other.position.y;
      const dz = obj.position.z - other.position.z;

      const direction =
        Math.abs(dx) > Math.abs(dz)
          ? dx > 0 ? 'right of' : 'left of'
          : dz > 0 ? 'behind' : 'in front of';

      refs.push(`${other.name} (${direction})`);
    }

    contextParts.push(`- ${obj.name}: at [${obj.position.x.toFixed(2)}, ${obj.position.y.toFixed(2)}, ${obj.position.z.toFixed(2)}], relative to: ${refs.join(', ') || 'self'}`);
  }

  return contextParts.join('\n');
}

function isContextualQuery(userInput: string): boolean {
  const contextualPatterns = [
    /where (is|was|does)/i,
    /where.*now/i,
    /did.*see/i,
    /remember/i,
    /previously/i,
    /last.*seen/i,
    /next to/i,
    /near/i,
    /between/i,
    /to the (left|right)/i,
    /behind/i,
    /in front/i,
  ];

  return contextualPatterns.some(pattern => pattern.test(userInput));
}

const workerState: WorkerState = {
  engine: null,
  isInitialized: false,
  currentModel: null,
  systemPrompt: '',
};

async function runTask(
  image: ImageBitmap,
  userInput: string,
  messageId: string,
  config: TaskRunnerConfig,
  worldMapContext?: { name: string; x: number; y: number; z: number }[]
): Promise<void> {
  if (!workerState.engine || !workerState.isInitialized) {
    sendError(messageId, 'Engine not initialized. Call init first.', 'MODEL_NOT_READY');
    return;
  }

  let enhancedUserInput = userInput;
  const isContextQuery = isContextualQuery(userInput);

  if (isContextQuery) {
    const spatialContext = worldMapContext && worldMapContext.length > 0
      ? worldMapContext.map(obj => `${obj.name} at [${obj.x.toFixed(2)}, ${obj.y.toFixed(2)}, ${obj.z.toFixed(2)}]`).join('; ')
      : getSpatialContext();

    if (spatialContext) {
      enhancedUserInput = `${userInput}\n\nKnown objects in environment: ${spatialContext}\n\nUse this spatial context to provide relative directions.`;
    }
  }

  const messages = PromptFactory.buildMessages(
    image,
    enhancedUserInput,
    undefined,
    workerState.systemPrompt,
    config
  );

  try {
    postMessage({ type: 'inference_start' });

    const response = await (workerState.engine!.chat.completions as any).create({
      messages,
      temperature: 0.1,
      max_tokens: config.maxTokens,
    });

    const content = response.choices[0]?.message?.content || '';
    const parseResult = parseJsonResponse(content, config.schema);

    const normalized = parseResult.data ? config.normalizeFn(parseResult.data) : config.defaultValue;

    if (!parseResult.success) {
      postMessage({
        type: 'warning',
        message: 'JSON parse required fallback extraction',
        rawResponse: content,
      });
    }

    const parsedData = parseResult.data as Record<string, unknown> | null;
    const completed = parsedData && typeof parsedData === 'object' && parsedData !== null
      ? (parsedData as { completed?: boolean }).completed
      : false;

    const detectedObjects = normalized && typeof normalized === 'object' && 'objects' in normalized
      ? (normalized as { objects: { name: string; category?: string }[] }).objects
      : [];

    if (detectedObjects.length > 0) {
      updateDetectionMemory(detectedObjects.map(obj => ({
        name: obj.name,
        category: obj.category || 'unknown',
        position: { x: 0, y: 0, z: 0 },
      })));
    }

    postMessage({
      type: config.responseType,
      messageId,
      response: normalized,
      completed,
      rawText: content,
      usage: response.usage,
      spatialContext: isContextQuery ? getSpatialContext() : undefined,
    } as WorkerIncomingMessage);
  } catch (error) {
    const err = error as Error;
    const code = mapErrorToCode(err);
    sendError(messageId, `Inference failed: ${err.message}`, code, err);
  } finally {
    image.close();
  }
}

async function initializeModel(modelId: string): Promise<void> {
  if (workerState.isInitialized && workerState.currentModel === modelId) {
    postMessage({ type: 'init_progress', progress: 100, status: 'already_loaded' });
    return;
  }

  try {
    postMessage({ type: 'init_progress', progress: 0, status: 'loading' });

    const initProgressCallback = (report: webllm.InitProgressReport) => {
      const progress = Math.round(report.progress * 100);
      postMessage({
        type: 'init_progress',
        progress,
        status: report.text || 'downloading',
        details: report,
      });
    };

    const appConfig = CONFIG.USE_INDEXED_DB_CACHE ? { useIndexedDBCache: true } : {};

    workerState.engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: initProgressCallback,
      ...appConfig,
    });

    workerState.isInitialized = true;
    workerState.currentModel = modelId;

    postMessage({
      type: 'init_complete',
      model: modelId,
      progress: 100,
      cacheStatus: CONFIG.USE_INDEXED_DB_CACHE ? 'indexeddb' : 'cache',
    });
  } catch (error) {
    const err = error as Error;
    const code = mapErrorToCode(err);
    sendError('', `Failed to initialize model: ${err.message}`, code, err);
  }
}

async function reloadEngine(): Promise<void> {
  if (workerState.engine) {
    try {
      await workerState.engine.unload();
    } catch (e) {
      logger.warn('Engine unload error:', e);
    }
  }
  workerState.engine = null;
  workerState.isInitialized = false;
  workerState.currentModel = null;
  postMessage({ type: 'reloaded' });
}

async function softReloadEngine(modelId?: string, newSystemPrompt?: string): Promise<void> {
  if (!workerState.engine) {
    logger.warn('[Worker] Cannot soft reload - no engine available');
    return;
  }

  try {
    postMessage({ type: 'inference_start' });

    const oldModel = workerState.currentModel;

    workerState.engine = null;
    workerState.isInitialized = false;

    await initializeModel(oldModel || modelId || CONFIG.DEFAULT_MODEL);

    if (newSystemPrompt && workerState.engine) {
      workerState.systemPrompt = newSystemPrompt;
    }

    postMessage({
      type: 'init_complete',
      model: oldModel || modelId,
      progress: 100,
      status: 'soft_reload',
    });
  } catch (error) {
    const err = error as Error;
    logger.error('[Worker] Soft reload failed:', err);
    sendError('', `Soft reload failed: ${err.message}`, 'WORKER_INIT_FAILED');

    if (workerState.engine) {
      try {
        await workerState.engine.unload();
      } catch (e) {
        logger.warn('[Worker] Engine unload after failed soft reload:', e);
      }
    }
    workerState.engine = null;
    workerState.isInitialized = false;
    workerState.currentModel = null;
  }
}

postMessage({ type: 'worker_ready' });