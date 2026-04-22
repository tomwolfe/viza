import * as webllm from '@mlc-ai/web-llm';
import type { WorkerIncomingMessage, WorkerOutgoingMessage } from '@/types/worker';
import { parseJsonResponse } from '@/utils/responseParser';
import { PromptFactory, type TaskRunnerConfig } from '@/services/promptManager';
import { VerificationResponseSchema } from '@/schemas/vision';
import { mapErrorToCode, sendError } from './messageUtils';
import { updateDetectionMemory, isContextualQuery, getSpatialContext, formatWorldMapContext } from './detectionMemory';

export interface WorkerState {
  engine: webllm.MLCEngine | null;
  isInitialized: boolean;
  currentModel: string | null;
  systemPrompt: string;
}

export interface TaskRunnerDeps {
  workerState: WorkerState;
  detectionMemory: { objects: { name: string; position: { x: number; y: number; z: number }; timestamp: number; category: string }[]; lastUpdate: number };
  postMessage: typeof postMessage;
}

export function createTaskRunner(deps: TaskRunnerDeps) {
  const { workerState, detectionMemory, postMessage } = deps;

  async function runTask(
    image: ImageBitmap,
    userInput: string,
    messageId: string,
    config: TaskRunnerConfig,
    worldMapContext?: { name: string; x: number; y: number; z: number }[]
  ): Promise<void> {
    if (!workerState.engine || !workerState.isInitialized) {
      sendError(messageId, 'Engine not initialized. Call init first.', 'MODEL_NOT_READY', undefined, postMessage);
      return;
    }

    let enhancedUserInput = userInput;
    const isContextQuery = isContextualQuery(userInput);

    if (isContextQuery) {
      const spatialContext = worldMapContext && worldMapContext.length > 0
        ? formatWorldMapContext(worldMapContext)
        : getSpatialContext(detectionMemory);

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
        updateDetectionMemory(detectionMemory, detectedObjects.map(obj => ({
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
        spatialContext: isContextQuery ? getSpatialContext(detectionMemory) : undefined,
      } as WorkerIncomingMessage);
    } catch (error) {
      const err = error as Error;
      const code = mapErrorToCode(err);
      sendError(messageId, `Inference failed: ${err.message}`, code, err, postMessage);
    } finally {
      image.close();
    }
  }

  async function runVerification(
    image: ImageBitmap,
    validationPrompt: string,
    targetObject: string,
    messageId: string,
    worldMapContext?: { name: string; x: number; y: number; z: number }[]
  ): Promise<void> {
    if (!workerState.engine || !workerState.isInitialized) {
      sendError(messageId, 'Engine not initialized. Call init first.', 'MODEL_NOT_READY', undefined, postMessage);
      return;
    }

    const userInput = `${validationPrompt}|||${targetObject}`;
    const messages = PromptFactory.buildMessages(
      image,
      userInput,
      undefined,
      workerState.systemPrompt,
      {
        maxTokens: 512,
        schema: VerificationResponseSchema,
        responseType: 'verification_complete',
        normalizeFn: (data: unknown) => data as { isCompleted: boolean; confidence: number },
        defaultValue: { isCompleted: false, confidence: 0 },
        promptBuilder: (input: string) => {
          const [validationPrompt, targetObject] = input.split('|||');
          return `You are a task verification assistant. Analyze this image to verify if a physical task step has been completed.\n\nTarget Object: "${targetObject || ''}"\nValidation Question: "${validationPrompt || ''}"\n\nReturn ONLY a valid JSON object with this structure:\n{\n  "isCompleted": boolean,\n  "confidence": number,\n  "reasoning": "string"\n}`;
        },
      }
    );

    try {
      postMessage({ type: 'inference_start' });

      const response = await (workerState.engine!.chat.completions as any).create({
        messages,
        temperature: 0.1,
        max_tokens: 512,
      });

      const content = response.choices[0]?.message?.content || '';
      const parseResult = parseJsonResponse(content, VerificationResponseSchema);

      const normalized = parseResult.data ? parseResult.data : { isCompleted: false, confidence: 0 };

      if (!parseResult.success) {
        postMessage({
          type: 'warning',
          message: 'JSON parse required fallback extraction for verification',
          rawResponse: content,
        });
      }

      const parsedData = parseResult.data as Record<string, unknown> | null;
      const isCompleted = parsedData && typeof parsedData === 'object' && parsedData !== null
        ? (parsedData as { isCompleted?: boolean }).isCompleted ?? false
        : false;
      const confidence = parsedData && typeof parsedData === 'object' && parsedData !== null
        ? (parsedData as { confidence?: number }).confidence ?? 0
        : 0;

      postMessage({
        type: 'verification_complete',
        messageId,
        isCompleted,
        confidence,
        rawText: content,
        usage: response.usage,
      } as WorkerIncomingMessage);
    } catch (error) {
      const err = error as Error;
      const code = mapErrorToCode(err);
      sendError(messageId, `Verification failed: ${err.message}`, code, err, postMessage);
    } finally {
      image.close();
    }
  }

  return {
    runTask,
    runVerification,
  };
}