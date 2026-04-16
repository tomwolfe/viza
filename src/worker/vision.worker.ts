import * as webllm from '@mlc-ai/web-llm';
import { z } from 'zod';
import type { WorkerOutgoingMessage, WorkerIncomingMessage, VizaErrorCode } from '@/types/worker';
import { CONFIG, logger, getVisionPrompt, getPlanningPrompt, getCategoryPrompt } from '@/config';
import { extractJsonFromText, parseJsonResponse } from '@/utils/responseParser';
import { TASK_CONFIGS, VisionResponseSchema, PlanningResponseSchema, type InferenceResult, type PlanningResult, type TaskRunnerConfig } from './workerConfigs';

type MessageHandler = (msg: { type: string; [key: string]: unknown }) => Promise<void> | void;

const messageHandlers: Record<string, MessageHandler> = {
  init: async (msg) => {
    const initMsg = msg as Extract<WorkerOutgoingMessage, { type: 'init' }>;
    if (initMsg.systemPrompt) {
      systemPrompt = initMsg.systemPrompt;
    }
    await initializeModel(initMsg.model || 'Phi-3.5-vision-instruct-q4f16_1-MLC');
  },

  chat: async (msg) => {
    const chatMsg = msg as Extract<WorkerOutgoingMessage, { type: 'chat' }>;
    if (!chatMsg.image) {
      postMessage({ type: 'error', message: 'Missing image for chat', messageId: chatMsg.messageId, errorCode: 'WORKER_INIT_FAILED' as VizaErrorCode });
      return;
    }
    await runTask(chatMsg.image, chatMsg.prompt, chatMsg.messageId, TASK_CONFIGS['chat']);
  },

  planning: async (msg) => {
    const planMsg = msg as Extract<WorkerOutgoingMessage, { type: 'planning' }>;
    if (!planMsg.image) {
      postMessage({ type: 'error', message: 'Missing image for planning', messageId: planMsg.messageId, errorCode: 'WORKER_INIT_FAILED' as VizaErrorCode });
      return;
    }
    await runTask(planMsg.image, planMsg.goal, planMsg.messageId, TASK_CONFIGS['planning']);
  },

  category: async (msg) => {
    const catMsg = msg as Extract<WorkerOutgoingMessage, { type: 'category' }>;
    if (!catMsg.image) {
      postMessage({ type: 'error', message: 'Missing image for category', messageId: catMsg.messageId, errorCode: 'WORKER_INIT_FAILED' as VizaErrorCode });
      return;
    }
    await runTask(catMsg.image, catMsg.goal, catMsg.messageId, TASK_CONFIGS['category']);
  },

  reload: async () => {
    await reloadEngine();
  },

  app_reset: () => {
    postMessage({ type: 'reset_ack' });
  },

  ping: () => {
    postMessage({ type: 'pong' });
  },
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
    postMessage({
      type: 'error',
      message: 'Engine not initialized. Call init first.',
      messageId,
    });
    return;
  }

  const userPrompt = config.promptBuilder(userInput);

  try {
    postMessage({ type: 'inference_start' });

    const messages: webllm.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: userPrompt },
        ],
      },
    ] as webllm.ChatCompletionMessageParam[];

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
    postMessage({
      type: 'error',
      messageId,
      message: `Inference failed: ${err.message}`,
      error: err.toString(),
    });
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

    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: initProgressCallback,
    });

    isInitialized = true;
    currentModel = modelId;

    postMessage({
      type: 'init_complete',
      model: modelId,
      progress: 100,
    });
  } catch (error) {
    const err = error as Error;
    postMessage({
      type: 'error',
      message: `Failed to initialize model: ${err.message}`,
      error: err.toString(),
    });
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

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type: string; [key: string]: unknown };
  const handler = messageHandlers[msg.type];

  if (handler) {
    await handler(msg);
  } else {
    postMessage({ type: 'unknown_message', received: msg.type });
  }
};

setInterval(() => {
  postMessage({ type: 'pong' });
}, 30000);

postMessage({ type: 'worker_ready' });