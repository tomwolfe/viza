import { z } from 'zod';

export const DetectedObjectSchema = z.object({
  name: z.string().min(1),
  bbox_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  action: z.string().default(''),
});

export const VisionResponseSchema = z.object({
  objects: z.array(DetectedObjectSchema),
  completed: z.boolean().default(false),
  rawText: z.string().optional(),
});

export type DetectedObject = z.infer<typeof DetectedObjectSchema>;
export type VisionResponse = z.infer<typeof VisionResponseSchema>;

export function parseVisionResponse(data: unknown): VisionResponse | null {
  const result = VisionResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.warn('[VisionSchema] Invalid response:', result.error.flatten());
  return null;
}