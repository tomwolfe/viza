import type { WorkerOutgoingMessage } from '@/types/worker';
import { TASK_CONFIGS } from '@/services/promptManager';
import { VizaWorker } from './VizaWorker';

const worker = new VizaWorker(self.postMessage.bind(self));

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as WorkerOutgoingMessage;

  switch (msg.type) {
    case 'init':
      await worker.initializeModel(msg.model || '', msg.messageId, msg.systemPrompt);
      break;

    case 'chat':
      if (msg.imageBase64) {
        await worker.runTask(msg.imageBase64, msg.prompt, msg.messageId, TASK_CONFIGS['chat'], msg.worldMapContext);
      }
      break;

    case 'planning':
      if (msg.imageBase64) {
        await worker.runTask(msg.imageBase64, msg.goal, msg.messageId, TASK_CONFIGS['planning'], msg.worldMapContext);
      }
      break;

    case 'category':
      if (msg.imageBase64) {
        await worker.runTask(msg.imageBase64, msg.goal, msg.messageId, TASK_CONFIGS['category'], msg.worldMapContext);
      }
      break;

    case 'verification':
      if (msg.imageBase64) {
        await worker.runVerification(msg.imageBase64, msg.validationPrompt, msg.targetObject, msg.messageId, msg.worldMapContext);
      }
      break;

    case 'reload':
      await worker.reloadEngine();
      break;

    case 'soft_reload':
      await worker.softReloadEngine(msg.model, msg.systemPrompt);
      break;

    case 'app_reset':
      self.postMessage({ type: 'reset_ack' });
      break;

    case 'ping':
      self.postMessage({ type: 'pong' });
      break;

    default:
      self.postMessage({
        type: 'error',
        messageId: '',
        message: `Unknown message type: ${(msg as any).type}`,
        errorCode: 'WORKER_INIT_FAILED',
      });
      break;
  }
};

self.postMessage({ type: 'worker_ready' });
