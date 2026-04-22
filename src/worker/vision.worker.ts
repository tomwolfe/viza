import type { WorkerOutgoingMessage } from '@/types/worker';
import { CONFIG } from '@/config';
import { TASK_CONFIGS } from '@/services/promptManager';
import { validateImage } from './messageUtils';
import { createEngineHandler, type EngineState } from './engineHandler';
import type { WorkerState } from './taskRunner';
import { createTaskRunner, type TaskRunnerDeps } from './taskRunner';
import { createDetectionMemory } from './detectionMemory';

const workerState: WorkerState = {
  engine: null,
  isInitialized: false,
  currentModel: null,
  systemPrompt: '',
};

const detectionMemory = createDetectionMemory();

const engineHandler = createEngineHandler({ postMessage });
const taskRunnerDeps: TaskRunnerDeps = {
  workerState,
  detectionMemory,
  postMessage,
};
const taskRunner = createTaskRunner(taskRunnerDeps);

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as WorkerOutgoingMessage;

  switch (msg.type) {
    case 'init':
      if (msg.systemPrompt) {
        workerState.systemPrompt = msg.systemPrompt;
      }
      await engineHandler.initializeModel(workerState, workerState.systemPrompt, msg.model || CONFIG.DEFAULT_MODEL);
      break;

    case 'chat':
      if (validateImage(msg, msg.messageId, msg.type)) {
        await taskRunner.runTask(msg.image!, msg.prompt, msg.messageId, TASK_CONFIGS['chat'], msg.worldMapContext);
      }
      break;

    case 'planning':
      if (validateImage(msg, msg.messageId, msg.type)) {
        await taskRunner.runTask(msg.image!, msg.goal, msg.messageId, TASK_CONFIGS['planning'], msg.worldMapContext);
      }
      break;

    case 'category':
      if (validateImage(msg, msg.messageId, msg.type)) {
        await taskRunner.runTask(msg.image!, msg.goal, msg.messageId, TASK_CONFIGS['category'], msg.worldMapContext);
      }
      break;

    case 'verification':
      if (validateImage(msg, msg.messageId, msg.type)) {
        await taskRunner.runVerification(msg.image!, msg.validationPrompt, msg.targetObject, msg.messageId, msg.worldMapContext);
      }
      break;

    case 'reload':
      await engineHandler.reloadEngine(workerState);
      break;

    case 'soft_reload':
      await engineHandler.softReloadEngine(workerState, workerState.systemPrompt, msg.model, msg.systemPrompt);
      break;

    case 'app_reset':
      postMessage({ type: 'reset_ack' });
      break;

    case 'ping':
      postMessage({ type: 'pong' });
      break;

    default:
      postMessage({
        type: 'error',
        messageId: '',
        message: `Unknown message type: ${(msg as any).type}`,
        errorCode: 'WORKER_INIT_FAILED',
      });
      break;
  }
};

postMessage({ type: 'worker_ready' });