import { z } from 'zod';
import type { WorkerIncomingMessage } from '@/types/worker';
import {
  VisionResponseSchemaRaw,
  PlanningResponseSchema,
  VerificationResponseSchema,
  type PlanningResponse,
  type VerificationResponse,
} from '@/schemas/vision';

export const JSON_OUTPUT_TEMPLATE = 'Return ONLY a valid JSON object with the structure:\n<<SCHEMA>>\nDo not include any other text. Only return the JSON object.';

export const VisionResponseSchema = VisionResponseSchemaRaw;
export type InferenceResult = z.infer<typeof VisionResponseSchemaRaw>;
export type PlanningResult = PlanningResponse;
export type VerificationResult = VerificationResponse;

export interface TaskRunnerConfig {
  promptBuilder: (userInput: string) => string;
  schema: z.ZodSchema<unknown>;
  normalizeFn: (raw: unknown) => object;
  defaultValue: object;
  responseType: WorkerIncomingMessage['type'];
  maxTokens: number;
}

export interface MessageWithImage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'image_url' | 'text';
    image_url?: { url: ImageBitmap };
    text?: string;
  }>;
}

export function buildVisionPrompt(): string {
  return 'Analyze this scene and identify objects of interest. ' + buildJsonPrompt('{\n' +
    '  "objects": [\n' +
    '    {\n' +
    '      "item": "string",\n' +
    '      "coordinates": [x, y, width, height],\n' +
    '      "action_step": "string"\n' +
    '    }\n' +
    '  ],\n' +
    '  "completed": boolean\n' +
    '}');
}

export function buildPlanningPrompt(userGoal: string): string {
  const isCleaningMode = /clean|organize|trash|garbage|mess/i.test(userGoal);
  const categoryFocus = isCleaningMode
    ? 'Identify all objects that match the goal category and create a prioritized cleanup plan.'
    : 'Analyze this image and create a detailed task plan for completing this goal.';

  return 'You are a spatial planning assistant. The user wants to: "' + userGoal + '"\n\n' + categoryFocus + '\n\n' + buildJsonPrompt('{' + '\n  "taskSteps": [\n    {\n      "id": "step-N",\n      "instruction": "Clear description of what to do",\n      "targetObject": "The specific object or category to target",\n      "validationPrompt": "How to verify this step is complete"\n    }\n  ]\n}');
}

export function buildCategoryPrompt(userGoal: string): string {
  const isTrash = /trash|garbage|discard|throw away|waste/i.test(userGoal);
  const isClutter = /clean|organize|mess|tidy|put away/i.test(userGoal);

  let categoryFocus = '';
  if (isTrash) {
    categoryFocus = 'Identify all TRASH items (wrappers, bottles, cans, paper waste, food containers, etc.) and return their bounding boxes.';
  } else if (isClutter) {
    categoryFocus = 'Identify all CLUTTER items (clothes, papers, scattered items, messy areas) and return their bounding boxes.';
  } else {
    categoryFocus = 'Identify all objects and their categories. Use "keep" for items to preserve, "trash" for waste, "clutter" for items to organize.';
  }

  return 'You are a spatial assistant for cleaning tasks.\n' +
    '  User Goal: "' + userGoal + '"\n\n' +
    '  ' + categoryFocus + '\n\n' +
    '  ' + buildJsonPrompt('{\n' +
    '    "objects": [\n' +
    '      {\n' +
    '        "item": "string - object name",\n' +
    '        "coordinates": [x, y, width, height],\n' +
    '        "action_step": "string - action to take with this object (e.g., \'+\x27throw away\x27, \'+\x27keep\x27, \'+\x27organize\x27)",\n' +
    '        "category": "string - one of: trash, clutter, keep, tool, unknown"\n' +
    '      }\n' +
    '    ],\n' +
    '    "completed": boolean\n' +
    '}');
}

export function buildVerifyPrompt(validationPrompt: string, targetObject: string): string {
  return 'You are a task verification assistant. Analyze this image to verify if a physical task step has been completed.\n\n' +
    '  Target Object: "' + targetObject + '"\n' +
    '  Validation Question: "' + validationPrompt + '"\n\n' +
    '  ' + buildJsonPrompt('{\n' +
    '    "isCompleted": boolean - true if the task is successfully completed based on the validation question,\n' +
    '    "confidence": number - a value between 0 and 1 indicating your confidence in this assessment,\n' +
    '    "reasoning": "string - brief explanation of your verification decision"\n' +
    '}\n') + '\n\n' +
    '  Be strict but fair. Only return isCompleted: true if you are confident the step is truly complete.';
}

export function buildSystemPrompt(taskContext: string, currentStep: string): string {
  return 'You are a spatial assistant for assembly tasks. Analyze this image based on the user\'s audio request.\n' +
    'Current Task Context: ' + taskContext + '\n' +
    'Current Step: ' + currentStep + '\n' +
    buildJsonPrompt('{\n' +
    '  "objects": [\n' +
    '    {\n' +
    '      "item": "string",\n' +
    '      "coordinates": [x, y, width, height],\n' +
    '      "action_step": "string"\n' +
    '    }\n' +
    '  ],\n' +
    '  "completed": boolean\n' +
    '}');
}

function normalizeVisionResult(raw: unknown): object {
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
}

function normalizeVerificationResult(raw: unknown): object {
  const r = raw as VerificationResult;
  return {
    isCompleted: r.isCompleted,
    confidence: r.confidence,
    reasoning: r.reasoning || '',
  };
}

export const TASK_CONFIGS: Record<string, TaskRunnerConfig> = {
  chat: {
    promptBuilder: (userInput: string) => userInput || buildVisionPrompt(),
    schema: VisionResponseSchema,
    normalizeFn: normalizeVisionResult,
    defaultValue: { objects: [] },
    responseType: 'inference_complete',
    maxTokens: 1024,
  },
  planning: {
    promptBuilder: (goal: string) => buildPlanningPrompt(goal),
    schema: PlanningResponseSchema,
    normalizeFn: (raw: unknown) => raw as object,
    defaultValue: { taskSteps: [] },
    responseType: 'planning_complete',
    maxTokens: 2048,
  },
  category: {
    promptBuilder: (goal: string) => buildCategoryPrompt(goal),
    schema: VisionResponseSchema,
    normalizeFn: normalizeVisionResult,
    defaultValue: { objects: [] },
    responseType: 'inference_complete',
    maxTokens: 1024,
  },
  verify: {
    promptBuilder: (input: string) => {
      const [validationPrompt, targetObject] = input.split('|||');
      return buildVerifyPrompt(validationPrompt || '', targetObject || '');
    },
    schema: VerificationResponseSchema,
    normalizeFn: normalizeVerificationResult,
    defaultValue: { isCompleted: false, confidence: 0, reasoning: '' },
    responseType: 'verification_complete',
    maxTokens: 512,
  },
};

export function buildMessages(
  image: ImageBitmap,
  userInput: string | undefined,
  goal: string | undefined,
  systemPrompt: string,
  config: TaskRunnerConfig
) {
  type MessageContent = string | Array<{ type: string; image_url?: { url: ImageBitmap }; text?: string }>;
  type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: MessageContent };
  const messages: ChatMessage[] = [];
  messages.push({ role: 'system', content: systemPrompt });

  if (config.responseType === 'planning_complete') {
    const prompt = buildPlanningPrompt(goal || '');
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: prompt },
      ],
    });
  } else if (config.responseType === 'verification_complete') {
    const [validationPrompt, targetObject] = (userInput || '').split('|||');
    const prompt = buildVerifyPrompt(validationPrompt || '', targetObject || '');
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: prompt },
      ],
    });
  } else if (config.responseType === 'inference_complete' && config.maxTokens === 1024) {
    const prompt = buildCategoryPrompt(goal || '');
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: prompt },
      ],
    });
  } else {
    const prompt = (userInput || buildVisionPrompt());
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: prompt },
      ],
    });
  }

  return messages;
}

function buildJsonPrompt(schema: string): string {
  return JSON_OUTPUT_TEMPLATE.replace('<<SCHEMA>>', schema);
}

export const PromptFactory = {
  vision: buildVisionPrompt,
  planning: buildPlanningPrompt,
  category: buildCategoryPrompt,
  verify: buildVerifyPrompt,
  system: buildSystemPrompt,
  buildMessages,
};