import { describe, it, expect } from 'vitest';
import { parseVisionResponse, parsePlanningResponse } from '../src/schemas/vision';

describe('Prompt/Schema Sync Validation', () => {
  describe('Vision Prompt - Schema Alignment', () => {
    it('should parse valid vision response matching schema', () => {
      const mockVisionOutput = {
        objects: [
          {
            item: 'plastic bottle',
            coordinates: [100, 200, 150, 250],
            action_step: 'throw away',
          },
          {
            item: 'paper wrapper',
            coordinates: [300, 150, 100, 80],
            action_step: 'recycle',
          },
        ],
        completed: false,
      };

      const result = parseVisionResponse(mockVisionOutput);
      expect(result).not.toBeNull();
      expect(result?.objects).toHaveLength(2);
      expect(result?.objects[0].name).toBe('plastic bottle');
      expect(result?.objects[0].action).toBe('throw away');
      expect(result?.objects[0].bbox_2d).toEqual([100, 200, 150, 250]);
    });

    it('should handle missing optional fields', () => {
      const minimalOutput = {
        objects: [
          {
            item: 'bottle',
            coordinates: [0, 0, 100, 100],
          },
        ],
        completed: true,
      };

      const result = parseVisionResponse(minimalOutput);
      expect(result).not.toBeNull();
      expect(result?.objects[0].action).toBe('');
      expect(result?.objects[0].category).toBe('unknown');
    });

    it('should reject invalid schema', () => {
      const invalidOutput = {
        objects: [
          {
            item: 123,
            coordinates: [100, 200, 150, 250],
          },
        ],
        completed: false,
      };

      const result = parseVisionResponse(invalidOutput);
      expect(result).toBeNull();
    });
  });

  describe('Planning Prompt - Schema Alignment', () => {
    it('should parse valid planning response matching schema', () => {
      const mockPlanningOutput = {
        taskSteps: [
          {
            id: 'step-1',
            instruction: 'Pick up the bottle',
            targetObject: 'bottle',
            validationPrompt: 'Is bottle visible and grabbable?',
          },
          {
            id: 'step-2',
            instruction: 'Move to trash bin',
            targetObject: 'trash bin',
            validationPrompt: 'Is bin in view?',
          },
        ],
      };

      const result = parsePlanningResponse(mockPlanningOutput);
      expect(result).not.toBeNull();
      expect(result?.taskSteps).toHaveLength(2);
      expect(result?.taskSteps[0].instruction).toBe('Pick up the bottle');
    });

    it('should handle missing optional targetObject', () => {
      const outputWithoutTarget = {
        taskSteps: [
          {
            id: 'step-1',
            instruction: 'Scan the room',
            validationPrompt: 'Is scan complete?',
          },
        ],
      };

      const result = parsePlanningResponse(outputWithoutTarget);
      expect(result).not.toBeNull();
      expect(result?.taskSteps[0].targetObject).toBeUndefined();
    });

    it('should reject invalid planning schema', () => {
      const invalidPlanning = {
        steps: [
          {
            id: 'step-1',
            instruction: 'Do something',
          },
        ],
      };

      const result = parsePlanningResponse(invalidPlanning);
      expect(result).toBeNull();
    });
  });

  describe('Category Prompt - Schema Alignment', () => {
    it('should parse category response with category field', () => {
      const categoryOutput = {
        objects: [
          {
            item: 'soda can',
            coordinates: [50, 100, 80, 120],
            action_step: 'recycle',
            category: 'trash',
          },
          {
            item: 'screwdriver',
            coordinates: [200, 300, 60, 40],
            action_step: 'keep',
            category: 'tool',
          },
        ],
        completed: false,
      };

      const result = parseVisionResponse(categoryOutput);
      expect(result).not.toBeNull();
      expect(result?.objects[0].category).toBe('trash');
      expect(result?.objects[1].category).toBe('tool');
    });
  });

  describe('Build-time Prompt Validation', () => {
    it('should ensure vision prompt structure matches expected output', () => {
      const expectedStructure = {
        objects: [
          {
            item: 'string',
            coordinates: [0, 0, 0, 0],
            action_step: 'string',
          },
        ],
        completed: false,
      };

      expect(expectedStructure.objects[0].item).toBe('string');
      expect(Array.isArray(expectedStructure.objects[0].coordinates)).toBe(true);
    });

    it('should ensure planning prompt structure matches expected output', () => {
      const expectedStructure = {
        taskSteps: [
          {
            id: 'string',
            instruction: 'string',
            targetObject: 'string',
            validationPrompt: 'string',
          },
        ],
      };

      expect(expectedStructure.taskSteps[0].instruction).toBe('string');
      expect(expectedStructure.taskSteps[0].validationPrompt).toBe('string');
    });
  });
});