import { z } from 'zod';
import type { WorkerIncomingMessage } from '@/types/worker';
import {
  VisionResponseSchemaRaw,
  PlanningResponseSchema,
  type VisionResponse,
  type PlanningResponse,
} from '@/schemas/vision';

export const VisionResponseSchema = VisionResponseSchemaRaw;
export type InferenceResult = z.infer<typeof VisionResponseSchemaRaw>;
export type PlanningResult = PlanningResponse;

export interface TaskRunnerConfig {
  promptBuilder: (userInput: string) => string;
  schema: z.ZodSchema<unknown>;
  normalizeFn: (raw: unknown) => object;
  defaultValue: object;
  responseType: WorkerIncomingMessage['type'];
  maxTokens: number;
}

export function buildVisionPrompt(): string {
  return `Analyze this scene and identify objects of interest. Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string",
      "coordinates": [x, y, width, height],
      "action_step": "string"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;
}

export function buildPlanningPrompt(userGoal: string): string {
  const isCleaningMode = /clean|organize|trash|garbage|mess/i.test(userGoal);
  const categoryFocus = isCleaningMode
    ? 'Identify all objects that match the goal category and create a prioritized cleanup plan.'
    : 'Analyze this image and create a detailed task plan for completing this goal.';

  return `You are a spatial planning assistant. The user wants to: "${userGoal}"

${categoryFocus}

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

  return `You are a spatial assistant for cleaning tasks.
User Goal: "${userGoal}"

${categoryFocus}

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

export function buildSystemPrompt(taskContext: string, currentStep: string): string {
  return `You are a spatial assistant for assembly tasks. Analyze this image based on the user's audio request.
Current Task Context: ${taskContext}
Current Step: ${currentStep}
Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string",
      "coordinates": [x, y, width, height],
      "action_step": "string"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;
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
};

export const PromptFactory = {
  vision: buildVisionPrompt,
  planning: buildPlanningPrompt,
  category: buildCategoryPrompt,
  system: buildSystemPrompt,
};