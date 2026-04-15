import { z } from 'zod';

export const DetectedObjectSchema = z.object({
  name: z.string().min(1),
  bbox_2d: z.array(z.number()).length(4),
  action: z.string().optional(),
});

export const VisionResponseSchema = z.object({
  objects: z.array(DetectedObjectSchema),
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