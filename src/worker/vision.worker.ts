import * as webllm from '@mlc-ai/web-llm';
import { z } from 'zod';
import type { WorkerOutgoingMessage, WorkerIncomingMessage, VizaErrorCode } from '@/types/worker';
import { CONFIG, logger } from '@/config';
import { extractJsonFromText, parseJsonResponse } from '@/utils/responseParser';
import { TASK_CONFIGS, buildChatMessages, buildPlanningMessages, buildCategoryMessages, type TaskRunnerConfig } from '@/services/promptManager';
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
        systemPrompt = msg.systemPrompt;
      }
      await initializeModel(msg.model || CONFIG.DEFAULT_MODEL);
      break;

    case 'chat':
      if (validateImage(msg)) {
        await runTask(msg.image!, msg.prompt, msg.messageId, TASK_CONFIGS['chat']);
      }
      break;

    case 'planning':
      if (validateImage(msg)) {
        await runTask(msg.image!, msg.goal, msg.messageId, TASK_CONFIGS['planning']);
      }
      break;

    case 'category':
      if (validateImage(msg)) {
        await runTask(msg.image!, msg.goal, msg.messageId, TASK_CONFIGS['category']);
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

let engine: webllm.MLCEngine | null = null;
let isInitialized = false;
let currentModel: string | null = null;
let systemPrompt = '';

async function runTask(
  image: ImageBitmap,
  userInput: string,
  messageId: string,
  config: TaskRunnerConfig
): Promise<void> {
  if (!engine || !isInitialized) {
    sendError(messageId, 'Engine not initialized. Call init first.', 'MODEL_NOT_READY');
    return;
  }

  let messages: webllm.ChatCompletionMessageParam[];
  
  if (config.responseType === 'planning_complete') {
    messages = buildPlanningMessages(image, userInput, systemPrompt) as webllm.ChatCompletionMessageParam[];
  } else if (config.responseType === 'inference_complete' && config.maxTokens === 1024) {
    messages = buildCategoryMessages(image, userInput, systemPrompt) as webllm.ChatCompletionMessageParam[];
  } else {
    messages = buildChatMessages(image, userInput, systemPrompt) as webllm.ChatCompletionMessageParam[];
  }

  try {
    postMessage({ type: 'inference_start' });

    const response = await engine.chat.completions.create({
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
    const completed = parseResult.data && typeof parseResult.data === 'object' && parseResult.data !== null
      ? (parseResult.data as { completed?: boolean }).completed
      : false;

    postMessage({
      type: config.responseType,
      messageId,
      response: normalized,
      completed,
      rawText: content,
      usage: response.usage,
    } as WorkerIncomingMessage);
  } catch (error) {
    const err = error as Error;
    const code = mapErrorToCode(err);
    sendError(messageId, `Inference failed: ${err.message}`, code, err);
  } finally {
    try {
      image.close();
    } catch (e) {
      logger.debug('[Worker] ImageBitmap already closed or invalid:', e);
    }
  }
}

async function initializeModel(modelId: string): Promise<void> {
  if (isInitialized && currentModel === modelId) {
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

    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: initProgressCallback,
      ...appConfig,
    });

    isInitialized = true;
    currentModel = modelId;

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
  if (engine) {
    try {
      await engine.unload();
    } catch (e) {
      logger.warn('Engine unload error:', e);
    }
  }
  engine = null;
  isInitialized = false;
  currentModel = null;
  postMessage({ type: 'reloaded' });
}

async function softReloadEngine(modelId?: string, newSystemPrompt?: string): Promise<void> {
  if (!engine) {
    logger.warn('[Worker] Cannot soft reload - no engine available');
    return;
  }

  try {
    postMessage({ type: 'inference_start' });

    const oldEngine = engine;
    const oldModel = currentModel;

    engine = null;
    isInitialized = false;

    await initializeModel(oldModel || modelId || CONFIG.DEFAULT_MODEL);

    if (newSystemPrompt && engine) {
      systemPrompt = newSystemPrompt;
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

    if (engine) {
      try {
        await engine.unload();
      } catch (e) {
        logger.warn('[Worker] Engine unload after failed soft reload:', e);
      }
    }
    engine = null;
    isInitialized = false;
    currentModel = null;
  }
}

postMessage({ type: 'worker_ready' });