import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import * as webllm from '@mlc-ai/web-llm';
import { logger } from '../src/config';
import {
  getVisionPrompt,
  getPlanningPrompt,
  getCategoryPrompt,
} from '../src/config';

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: vi.fn().mockResolvedValue({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    unload: vi.fn(),
  }),
}));

describe('worker.ts prompt generation', () => {
  describe('getVisionPrompt', () => {
    it('should return a valid JSON prompt for vision task', () => {
      const prompt = getVisionPrompt();

      expect(prompt).toContain('"objects"');
      expect(prompt).toContain('"item"');
      expect(prompt).toContain('"coordinates"');
      expect(prompt).toContain('"action_step"');
      expect(prompt).toContain('"completed"');
      expect(prompt).toContain('JSON object');
    });
  });

  describe('getPlanningPrompt', () => {
    it('should return a valid JSON prompt for cleaning goal', () => {
      const prompt = getPlanningPrompt('clean the room');

      expect(prompt).toContain('"taskSteps"');
      expect(prompt).toContain('"instruction"');
      expect(prompt).toContain('"targetObject"');
      expect(prompt).toContain('clean');
    });

    it('should return a valid JSON prompt for trash goal', () => {
      const prompt = getPlanningPrompt('throw away trash');

      expect(prompt).toContain('"taskSteps"');
      expect(prompt).toContain('cleanup');
    });
  });

  describe('getCategoryPrompt', () => {
    it('should return a valid JSON prompt for trash category', () => {
      const prompt = getCategoryPrompt('throw away trash');

      expect(prompt).toContain('"objects"');
      expect(prompt).toContain('TRASH');
      expect(prompt).toContain('"category"');
    });

    it('should return a valid JSON prompt for clutter category', () => {
      const prompt = getCategoryPrompt('organize clutter');

      expect(prompt).toContain('"objects"');
      expect(prompt).toContain('CLUTTER');
    });

    it('should return a mixed category prompt for generic goal', () => {
      const prompt = getCategoryPrompt('help me');

      expect(prompt).toContain('"objects"');
      expect(prompt).toContain('trash');
      expect(prompt).toContain('clutter');
      expect(prompt).toContain('keep');
    });
  });
});

describe('worker.ts response normalization', () => {
  const VisionResponseSchema = z.object({
    objects: z.array(z.object({
      item: z.string(),
      coordinates: z.array(z.number()).length(4),
      action_step: z.string().optional(),
      category: z.string().optional(),
    })),
    completed: z.boolean().optional(),
  });

  describe('VisionResponseSchema parsing', () => {
    it('should parse valid vision response', () => {
      const validResponse = {
        objects: [
          { item: 'bottle', coordinates: [100, 100, 50, 50], action_step: 'throw away' },
        ],
        completed: false,
      };

      const result = VisionResponseSchema.parse(validResponse);
      expect(result.objects).toHaveLength(1);
      expect(result.objects[0].item).toBe('bottle');
    });

    it('should parse response with category', () => {
      const validResponse = {
        objects: [
          { item: 'paper', coordinates: [0, 0, 100, 100], action_step: 'recycle', category: 'trash' },
        ],
        completed: true,
      };

      const result = VisionResponseSchema.parse(validResponse);
      expect(result.objects[0].category).toBe('trash');
    });

    it('should fail on invalid coordinates length', () => {
      const invalidResponse = {
        objects: [
          { item: 'bottle', coordinates: [100, 100], action_step: 'throw away' },
        ],
        completed: false,
      };

      expect(() => VisionResponseSchema.parse(invalidResponse)).toThrow();
    });

    it('should fail on missing item field', () => {
      const invalidResponse = {
        objects: [
          { coordinates: [100, 100, 50, 50], action_step: 'throw away' },
        ],
        completed: false,
      };

      expect(() => VisionResponseSchema.parse(invalidResponse)).toThrow();
    });
  });
});

const PlanningResponseSchema = z.object({
  taskSteps: z.array(z.object({
    id: z.string(),
    instruction: z.string(),
    targetObject: z.string().optional(),
    validationPrompt: z.string(),
  })),
});

describe('worker.ts planning response', () => {
  describe('PlanningResponseSchema parsing', () => {
    it('should parse valid planning response', () => {
      const validResponse = {
        taskSteps: [
          { id: 'step-1', instruction: 'Pick up bottle', targetObject: 'bottle', validationPrompt: 'bottle removed' },
          { id: 'step-2', instruction: 'Throw away', validationPrompt: 'bin emptied' },
        ],
      };

      const result = PlanningResponseSchema.parse(validResponse);
      expect(result.taskSteps).toHaveLength(2);
      expect(result.taskSteps[0].id).toBe('step-1');
    });

    it('should parse response without optional targetObject', () => {
      const validResponse = {
        taskSteps: [
          { id: 'step-1', instruction: 'Pick up bottle', validationPrompt: 'bottle removed' },
        ],
      };

      const result = PlanningResponseSchema.parse(validResponse);
      expect(result.taskSteps[0].targetObject).toBeUndefined();
    });
  });
});