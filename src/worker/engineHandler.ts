import * as webllm from '@mlc-ai/web-llm';
import { CONFIG, logger } from '@/config';
import { sendError, mapErrorToCode } from './messageUtils';

export interface EngineHandlerDeps {
  postMessage: typeof postMessage;
}

export interface EngineState {
  engine: webllm.MLCEngine | null;
  isInitialized: boolean;
  currentModel: string | null;
}

export function createEngineHandler(deps: EngineHandlerDeps) {
  const { postMessage } = deps;

  async function initializeModel(
    engineState: EngineState,
    systemPrompt: string,
    modelId: string
  ): Promise<void> {
    if (engineState.isInitialized && engineState.currentModel === modelId) {
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

      engineState.engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: initProgressCallback,
        ...appConfig,
      });

      engineState.isInitialized = true;
      engineState.currentModel = modelId;

      postMessage({
        type: 'init_complete',
        model: modelId,
        progress: 100,
        cacheStatus: CONFIG.USE_INDEXED_DB_CACHE ? 'indexeddb' : 'cache',
      });
    } catch (error) {
      const err = error as Error;
      const code = mapErrorToCode(err);
      sendError('', `Failed to initialize model: ${err.message}`, code, err, postMessage);
    }
  }

  async function reloadEngine(engineState: EngineState): Promise<void> {
    if (engineState.engine) {
      try {
        await engineState.engine.unload();
      } catch (e) {
        logger.warn('Engine unload error:', e);
      }
    }
    engineState.engine = null;
    engineState.isInitialized = false;
    engineState.currentModel = null;
    postMessage({ type: 'reloaded' });
  }

  async function softReloadEngine(
    engineState: EngineState,
    systemPrompt: string,
    modelId?: string,
    newSystemPrompt?: string
  ): Promise<void> {
    if (!engineState.engine) {
      logger.warn('[Worker] Cannot soft reload - no engine available');
      return;
    }

    try {
      postMessage({ type: 'inference_start' });

      const oldModel = engineState.currentModel;

      engineState.engine = null;
      engineState.isInitialized = false;

      await initializeModel(engineState, systemPrompt, oldModel || modelId || CONFIG.DEFAULT_MODEL);

      if (newSystemPrompt && engineState.engine) {
        engineState.systemPrompt = newSystemPrompt;
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
      sendError('', `Soft reload failed: ${err.message}`, 'WORKER_INIT_FAILED', err, postMessage);

      if (engineState.engine) {
        try {
          await engineState.engine.unload();
        } catch (e) {
          logger.warn('[Worker] Engine unload after failed soft reload:', e);
        }
      }
      engineState.engine = null;
      engineState.isInitialized = false;
      engineState.currentModel = null;
    }
  }

  return {
    initializeModel,
    reloadEngine,
    softReloadEngine,
  };
}