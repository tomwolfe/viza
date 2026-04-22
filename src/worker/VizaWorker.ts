import * as webllm from '@mlc-ai/web-llm';
import { CONFIG, logger } from '@/config';
import { PromptFactory, type TaskRunnerConfig } from '@/services/promptManager';
import { VerificationResponseSchema } from '@/schemas/vision';
import { parseJsonResponse } from '@/utils/responseParser';
import { mapErrorToCode, sendError } from './messageUtils';
import { 
  createDetectionMemory, 
  updateDetectionMemory, 
  isContextualQuery, 
  getSpatialContext, 
  formatWorldMapContext 
} from './detectionMemory';

export interface WorkerState {
  engine: webllm.MLCEngine | null;
  isInitialized: boolean;
  currentModel: string | null;
  systemPrompt: string;
}

export class VizaWorker {
  private state: WorkerState = {
    engine: null,
    isInitialized: false,
    currentModel: null,
    systemPrompt: '',
  };

  private detectionMemory = createDetectionMemory();

  constructor(private postMessageFn: typeof postMessage) {}

  async initializeModel(modelId: string, systemPrompt?: string): Promise<void> {
    if (systemPrompt) {
      this.state.systemPrompt = systemPrompt;
    }

    if (this.state.isInitialized && this.state.currentModel === modelId) {
      this.postMessageFn({ type: 'init_progress', progress: 100, status: 'already_loaded' });
      return;
    }

    try {
      this.postMessageFn({ type: 'init_progress', progress: 0, status: 'loading' });

      const initProgressCallback = (report: webllm.InitProgressReport) => {
        const progress = Math.round(report.progress * 100);
        this.postMessageFn({
          type: 'init_progress',
          progress,
          status: report.text || 'downloading',
          details: report,
        });
      };

      const appConfig = CONFIG.USE_INDEXED_DB_CACHE ? { useIndexedDBCache: true } : {};

      this.state.engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: initProgressCallback,
        ...appConfig,
      });

      this.state.isInitialized = true;
      this.state.currentModel = modelId;

      this.postMessageFn({
        type: 'init_complete',
        model: modelId,
        progress: 100,
        cacheStatus: CONFIG.USE_INDEXED_DB_CACHE ? 'indexeddb' : 'cache',
      });
    } catch (error) {
      const err = error as Error;
      const code = mapErrorToCode(err);
      sendError('', `Failed to initialize model: ${err.message}`, code, err, this.postMessageFn);
    }
  }

  async runTask(
    image: ImageBitmap,
    userInput: string,
    messageId: string,
    config: TaskRunnerConfig,
    worldMapContext?: { name: string; x: number; y: number; z: number }[]
  ): Promise<void> {
    if (!this.state.engine || !this.state.isInitialized) {
      sendError(messageId, 'Engine not initialized. Call init first.', 'MODEL_NOT_READY', undefined, this.postMessageFn);
      image.close();
      return;
    }

    let enhancedUserInput = userInput;
    const isContextQuery = isContextualQuery(userInput);

    if (isContextQuery) {
      const spatialContext = worldMapContext && worldMapContext.length > 0
        ? formatWorldMapContext(worldMapContext)
        : getSpatialContext(this.detectionMemory);

      if (spatialContext) {
        enhancedUserInput = `${userInput}\n\nKnown objects in environment: ${spatialContext}\n\nUse this spatial context to provide relative directions.`;
      }
    }

    const messages = PromptFactory.buildMessages(
      image,
      enhancedUserInput,
      undefined,
      this.state.systemPrompt,
      config
    );

    try {
      this.postMessageFn({ type: 'inference_start' });

      const response = await (this.state.engine!.chat.completions as any).create({
        messages,
        temperature: 0.1,
        max_tokens: config.maxTokens,
      });

      const content = response.choices[0]?.message?.content || '';
      const parseResult = parseJsonResponse(content, config.schema);

      const normalized = parseResult.data ? config.normalizeFn(parseResult.data) : config.defaultValue;

      if (!parseResult.success) {
        this.postMessageFn({
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
        updateDetectionMemory(this.detectionMemory, detectedObjects.map(obj => ({
          name: obj.name,
          category: obj.category || 'unknown',
          position: { x: 0, y: 0, z: 0 },
        })));
      }

      this.postMessageFn({
        type: config.responseType,
        messageId,
        response: normalized,
        completed,
        rawText: content,
        usage: response.usage,
        spatialContext: isContextQuery ? getSpatialContext(this.detectionMemory) : undefined,
      });
    } catch (error) {
      const err = error as Error;
      const code = mapErrorToCode(err);
      sendError(messageId, `Inference failed: ${err.message}`, code, err, this.postMessageFn);
    } finally {
      image.close();
    }
  }

  async runVerification(
    image: ImageBitmap,
    validationPrompt: string,
    targetObject: string,
    messageId: string,
    worldMapContext?: { name: string; x: number; y: number; z: number }[]
  ): Promise<void> {
    if (!this.state.engine || !this.state.isInitialized) {
      sendError(messageId, 'Engine not initialized. Call init first.', 'MODEL_NOT_READY', undefined, this.postMessageFn);
      image.close();
      return;
    }

    const userInput = `${validationPrompt}|||${targetObject}`;
    const messages = PromptFactory.buildMessages(
      image,
      userInput,
      undefined,
      this.state.systemPrompt,
      {
        maxTokens: 512,
        schema: VerificationResponseSchema,
        responseType: 'verification_complete',
        normalizeFn: (data: unknown) => data as { isCompleted: boolean; confidence: number },
        defaultValue: { isCompleted: false, confidence: 0 },
        promptBuilder: (input: string) => {
          const [valPrompt, target] = input.split('|||');
          return `You are a task verification assistant. Analyze this image to verify if a physical task step has been completed.\n\nTarget Object: "${target || ''}"\nValidation Question: "${valPrompt || ''}"\n\nReturn ONLY a valid JSON object with this structure:\n{\n  "isCompleted": boolean,\n  "confidence": number,\n  "reasoning": "string"\n}`;
        },
      }
    );

    try {
      this.postMessageFn({ type: 'inference_start' });

      const response = await (this.state.engine!.chat.completions as any).create({
        messages,
        temperature: 0.1,
        max_tokens: 512,
      });

      const content = response.choices[0]?.message?.content || '';
      const parseResult = parseJsonResponse(content, VerificationResponseSchema);

      const parsedData = parseResult.data as Record<string, unknown> | null;
      const isCompleted = parsedData && typeof parsedData === 'object' && parsedData !== null
        ? (parsedData as { isCompleted?: boolean }).isCompleted ?? false
        : false;
      const confidence = parsedData && typeof parsedData === 'object' && parsedData !== null
        ? (parsedData as { confidence?: number }).confidence ?? 0
        : 0;

      this.postMessageFn({
        type: 'verification_complete',
        messageId,
        isCompleted,
        confidence,
        rawText: content,
        usage: response.usage,
      });
    } catch (error) {
      const err = error as Error;
      const code = mapErrorToCode(err);
      sendError(messageId, `Verification failed: ${err.message}`, code, err, this.postMessageFn);
    } finally {
      image.close();
    }
  }

  async reloadEngine(): Promise<void> {
    if (this.state.engine) {
      try {
        await this.state.engine.unload();
      } catch (e) {
        logger.warn('Engine unload error:', e);
      }
    }
    this.state.engine = null;
    this.state.isInitialized = false;
    this.state.currentModel = null;
    this.postMessageFn({ type: 'reloaded' });
  }

  async softReloadEngine(modelId?: string, newSystemPrompt?: string): Promise<void> {
    if (!this.state.engine) {
      logger.warn('[Worker] Cannot soft reload - no engine available');
      return;
    }

    try {
      this.postMessageFn({ type: 'inference_start' });
      const oldModel = this.state.currentModel;
      
      if (this.state.engine) {
        await this.state.engine.unload();
      }
      
      this.state.engine = null;
      this.state.isInitialized = false;

      await this.initializeModel(oldModel || modelId || CONFIG.DEFAULT_MODEL, newSystemPrompt || this.state.systemPrompt);
    } catch (error) {
      const err = error as Error;
      logger.error('[Worker] Soft reload failed:', err);
      sendError('', `Soft reload failed: ${err.message}`, 'WORKER_INIT_FAILED', err, this.postMessageFn);
    }
  }
}
