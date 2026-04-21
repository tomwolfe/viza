import { z } from 'zod';
import { logger } from '@/config';

const LlmDetectedObjectSchema = z.object({
  item: z.string().min(1),
  coordinates: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  action_step: z.string().optional(),
  category: z.string().optional(),
});

const RawDetectedObjectSchema = z.object({
  name: z.string().min(1),
  bbox_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  action: z.string().default(''),
  category: z.string().optional(),
  confidence: z.number().optional(),
});

export const DetectedObjectSchema = RawDetectedObjectSchema;

export const LlmVisionResponseSchema = z.object({
  objects: z.array(LlmDetectedObjectSchema),
  completed: z.boolean().default(false),
  rawText: z.string().optional(),
});

export const VisionResponseSchemaRaw = LlmVisionResponseSchema;

export const VisionResponseSchema = LlmVisionResponseSchema
  .transform((response) => ({
    objects: response.objects.map((obj) => ({
      name: obj.item,
      bbox_2d: obj.coordinates,
      action: obj.action_step || '',
      category: obj.category || 'unknown',
    })),
    completed: response.completed,
    rawText: response.rawText,
  }));

export const TaskStepSchema = z.object({
  id: z.string(),
  instruction: z.string(),
  targetObject: z.string().optional(),
  validationPrompt: z.string(),
});

export const CorrectionTaskStepSchema = z.object({
  id: z.string(),
  instruction: z.string(),
  targetObject: z.string().optional(),
  validationPrompt: z.string(),
  isCorrection: z.literal(true),
  originalStepIndex: z.number(),
});

export const PlanningResponseSchema = z.object({
  taskSteps: z.array(TaskStepSchema),
  rawText: z.string().optional(),
});

export const CorrectionResponseSchema = z.object({
  correctionSteps: z.array(CorrectionTaskStepSchema),
  analysis: z.string(),
  rawText: z.string().optional(),
});

export type DetectedObject = z.infer<typeof DetectedObjectSchema>;
export type VisionResponse = z.infer<typeof VisionResponseSchema>;
export type TaskStep = z.infer<typeof TaskStepSchema>;
export type CorrectionTaskStep = z.infer<typeof CorrectionTaskStepSchema>;
export type PlanningResponse = z.infer<typeof PlanningResponseSchema>;
export type CorrectionResponse = z.infer<typeof CorrectionResponseSchema>;

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