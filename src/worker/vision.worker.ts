import * as webllm from '@mlc-ai/web-llm';
import { z } from 'zod';
import type { WorkerOutgoingMessage, WorkerIncomingMessage } from '@/types/worker';

interface TaskRunnerConfig {
  promptBuilder: (userInput: string) => string;
  schema: z.ZodSchema<unknown>;
  normalizeFn: (raw: unknown) => object;
  defaultValue: object;
  responseType: WorkerIncomingMessage['type'];
  maxTokens: number;
}

let engine: webllm.MLCEngine | null = null;
let isInitialized = false;
let currentModel: string | null = null;
let systemPrompt = '';

const VisionResponseSchema = z.object({
  objects: z.array(z.object({
    item: z.string(),
    coordinates: z.array(z.number()).length(4),
    action_step: z.string().optional(),
    category: z.string().optional(),
  })),
  completed: z.boolean().optional(),
});

const PlanningResponseSchema = z.object({
  taskSteps: z.array(z.object({
    id: z.string(),
    instruction: z.string(),
    targetObject: z.string().optional(),
    validationPrompt: z.string(),
  })),
});

export type InferenceResult = z.infer<typeof VisionResponseSchema>;
export type PlanningResult = z.infer<typeof PlanningResponseSchema>;

function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
    }
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonCandidate);
    } catch {
    }
  }
  return null;
}

const TASK_CONFIGS: Record<string, TaskRunnerConfig> = {
  chat: {
    promptBuilder: (prompt: string) => prompt || 'Analyze this scene and identify objects of interest.',
    schema: VisionResponseSchema,
    normalizeFn: (raw: unknown) => {
      const r = raw as InferenceResult;
      return {
        objects: r.objects.map((obj) => ({
          name: obj.item,
          bbox_2d: obj.coordinates,
          action: obj.action_step || '',
          category: obj.category || 'unknown',
        })),
        completed: r.completed || false,
      };
    },
    defaultValue: { objects: [] },
    responseType: 'inference_complete',
    maxTokens: 1024,
  },
  planning: {
    promptBuilder: (goal: string) => {
      const isCleaningMode = /clean|organize|trash|garbage|mess/i.test(goal);
      if (isCleaningMode) {
        return `You are a spatial planning assistant. The user wants to: "${goal}"

Analyze this image and create a detailed task plan. Identify all objects that match the goal category.

Return ONLY a valid JSON object with this structure:
{
  "taskSteps": [
    {
      "id": "step-N",
      "instruction": "Clear description of what to do",
      "targetObject": "The specific object or category to target",
      "validationPrompt": "How to verify this step is complete"
    }
  ]
}

Provide 5-10 specific steps. Focus on actionable items. Do not include any other text.`;
      }
      return `You are a spatial planning assistant. The user wants to: "${goal}"

Analyze this image and create a detailed task plan for completing this goal.

Return ONLY a valid JSON object with this structure:
{
  "taskSteps": [
    {
      "id": "step-N",
      "instruction": "Clear description of what to do",
      "targetObject": "The specific object or category to target",
      "validationPrompt": "How to verify this step is complete"
    }
  ]
}

Provide 5-10 specific steps in logical order. Do not include any other text.`;
    },
    schema: PlanningResponseSchema,
    normalizeFn: (raw: unknown) => raw as object,
    defaultValue: { taskSteps: [] },
    responseType: 'planning_complete',
    maxTokens: 2048,
  },
  category: {
    promptBuilder: (goal: string) => {
      const isTrash = /trash|garbage|discard|throw away|waste/i.test(goal);
      const isClutter = /clean|organize|mess|tidy|put away/i.test(goal);
      if (isTrash) {
        return `You are a spatial assistant for cleaning tasks.
User Goal: "${goal}"

Identify all TRASH items (wrappers, bottles, cans, paper waste, food containers, etc.) and return their bounding boxes.

Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string - object name",
      "coordinates": [x, y, width, height],
      "action_step": "string - action to take with this object (e.g., 'throw away', 'keep', 'organize')",
      "category": "string - one of: trash, clutter, keep, tool, unknown"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;
      }
      if (isClutter) {
        return `You are a spatial assistant for cleaning tasks.
User Goal: "${goal}"

Identify all CLUTTER items (clothes, papers, scattered items, messy areas) and return their bounding boxes.

Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string - object name",
      "coordinates": [x, y, width, height],
      "action_step": "string - action to take with this object (e.g., 'throw away', 'keep', 'organize')",
      "category": "string - one of: trash, clutter, keep, tool, unknown"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;
      }
      return `You are a spatial assistant for cleaning tasks.
User Goal: "${goal}"

Identify all objects and their categories. Use "keep" for items to preserve, "trash" for waste, "clutter" for items to organize.

Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string - object name",
      "coordinates": [x, y, width, height],
      "action_step": "string - action to take with this object (e.g., 'throw away', 'keep', 'organize')",
      "category": "string - one of: trash, clutter, keep, tool, unknown"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;
    },
    schema: VisionResponseSchema,
    normalizeFn: (raw: unknown) => {
      const r = raw as InferenceResult;
      return {
        objects: r.objects.map((obj) => ({
          name: obj.item,
          bbox_2d: obj.coordinates,
          action: obj.action_step || '',
          category: obj.category || 'unknown',
        })),
        completed: r.completed || false,
      };
    },
    defaultValue: { objects: [] },
    responseType: 'inference_complete',
    maxTokens: 1024,
  },
};

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
    const parsedResponse = extractJsonFromText(content);

    let validated = null;
    try {
      validated = config.schema.parse(parsedResponse);
    } catch {
      validated = null;
    }

    if (!validated) {
      postMessage({
        type: 'warning',
        message: 'JSON parse required fallback extraction',
        rawResponse: content,
      });
    }

    const normalized = validated ? config.normalizeFn(validated) : config.defaultValue;
    const completed = validated && typeof validated === 'object' && validated !== null
      ? (validated as { completed?: boolean }).completed
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
    image.close();
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
      console.warn('Engine unload error:', e);
    }
  }
  engine = null;
  isInitialized = false;
  currentModel = null;
  postMessage({ type: 'reloaded' });
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as WorkerOutgoingMessage;

  switch (msg.type) {
    case 'init':
      if (msg.systemPrompt) {
        systemPrompt = msg.systemPrompt;
      }
      await initializeModel(msg.model || 'Phi-3.5-vision-instruct-q4f16_1-MLC');
      break;

    case 'chat':
      await runTask(msg.image, msg.prompt, msg.messageId, TASK_CONFIGS['chat']);
      break;

    case 'planning':
      await runTask(msg.image, msg.goal, msg.messageId, TASK_CONFIGS['planning']);
      break;

    case 'category':
      await runTask(msg.image, msg.goal, msg.messageId, TASK_CONFIGS['category']);
      break;

    case 'reload':
      await reloadEngine();
      break;

    case 'app_reset':
      postMessage({ type: 'reset_ack' });
      break;

    case 'ping':
      postMessage({ type: 'pong' });
      break;

    default:
      postMessage({ type: 'unknown_message', received: (msg as { type: string }).type });
      break;
  }
};

setInterval(() => {
  postMessage({ type: 'pong' });
}, 30000);

postMessage({ type: 'worker_ready' });