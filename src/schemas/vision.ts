import { z } from 'zod';
import { logger } from '@/config';

export const DetectedObjectSchema = z.object({
  name: z.string().min(1),
  bbox_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  action: z.string().default(''),
  category: z.string().optional(),
  confidence: z.number().optional(),
});

export const VisionResponseSchema = z.object({
  objects: z.array(DetectedObjectSchema),
  completed: z.boolean().default(false),
  rawText: z.string().optional(),
});

export const TaskStepSchema = z.object({
  id: z.string(),
  instruction: z.string(),
  targetObject: z.string().optional(),
  validationPrompt: z.string(),
});

export const PlanningResponseSchema = z.object({
  taskSteps: z.array(TaskStepSchema),
  rawText: z.string().optional(),
});

export type DetectedObject = z.infer<typeof DetectedObjectSchema>;
export type VisionResponse = z.infer<typeof VisionResponseSchema>;
export type TaskStep = z.infer<typeof TaskStepSchema>;
export type PlanningResponse = z.infer<typeof PlanningResponseSchema>;

export function parseVisionResponse(data: unknown): VisionResponse | null {
  const result = VisionResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  logger.warn('[VisionSchema] Invalid response:', result.error.flatten());
  return null;
}

export function parsePlanningResponse(data: unknown): PlanningResponse | null {
  const result = PlanningResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  logger.warn('[VisionSchema] Invalid planning response:', result.error.flatten());
  return null;
}