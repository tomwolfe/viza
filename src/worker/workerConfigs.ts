import { z } from 'zod';
import type { WorkerIncomingMessage } from '@/types/worker';
import { getVisionPrompt, getPlanningPrompt, getCategoryPrompt } from '@/config';

export interface TaskRunnerConfig {
  promptBuilder: (userInput: string) => string;
  schema: z.ZodSchema<unknown>;
  normalizeFn: (raw: unknown) => object;
  defaultValue: object;
  responseType: WorkerIncomingMessage['type'];
  maxTokens: number;
}

export const VisionResponseSchema = z.object({
  objects: z.array(z.object({
    item: z.string(),
    coordinates: z.array(z.number()).length(4),
    action_step: z.string().optional(),
    category: z.string().optional(),
  })),
  completed: z.boolean().optional(),
});

export const PlanningResponseSchema = z.object({
  taskSteps: z.array(z.object({
    id: z.string(),
    instruction: z.string(),
    targetObject: z.string().optional(),
    validationPrompt: z.string(),
  })),
});

export type InferenceResult = z.infer<typeof VisionResponseSchema>;
export type PlanningResult = z.infer<typeof PlanningResponseSchema>;

export const TASK_CONFIGS: Record<string, TaskRunnerConfig> = {
  chat: {
    promptBuilder: (userInput: string) => userInput || getVisionPrompt(),
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
    promptBuilder: (goal: string) => getPlanningPrompt(goal),
    schema: PlanningResponseSchema,
    normalizeFn: (raw: unknown) => raw as object,
    defaultValue: { taskSteps: [] },
    responseType: 'planning_complete',
    maxTokens: 2048,
  },
  category: {
    promptBuilder: (goal: string) => getCategoryPrompt(goal),
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