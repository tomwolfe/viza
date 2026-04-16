import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractJsonFromText, parseJsonResponse, ParseResult } from '../src/utils/responseParser';
import { logger } from '@/config';

// Mock logger to prevent actual logging during tests
vi.mock('@/config', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock a simple schema parser for testing
const mockSchema = {
  parse: vi.fn(),
};

describe('Response Parser Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- extractJsonFromText tests ---
  describe('extractJsonFromText', () => {
    it('should extract JSON from a fenced code block (json)', () => {
      const rawText = 'Some preamble text\n```json\n{"key": "value"}\n```\nMore text';
      const expected = { key: 'value' };
      expect(extractJsonFromText(rawText)).toEqual(expected);
    });

    it('should extract JSON from a fenced code block without language specifier', () => {
      const rawText = '```\n{"key": "value"}\n```';
      const expected = { key: 'value' };
      expect(extractJsonFromText(rawText)).toEqual(expected);
    });

    it('should extract JSON when it is the only content in the trimmed text', () => {
      const rawText = '{"key": "value"}';
      const expected = { key: 'value' };
      expect(extractJsonFromText(rawText)).toEqual(expected);
    });

    it('should extract JSON embedded without code blocks', () => {
      const rawText = '{"key": "value"} some extra text';
      const expected = { key: 'value' };
      expect(extractJsonFromText(rawText)).toEqual(expected);
    });

    it('should return null if no valid JSON structure is found', () => {
      const rawText = 'This is just plain text.';
      expect(extractJsonFromText(rawText)).toBeNull();
    });

    it('should return null if the JSON structure is malformed', () => {
      const rawText = '{"key": "value"'; // Missing closing brace
      expect(extractJsonFromText(rawText)).toBeNull();
    });
  });

  // --- parseJsonResponse tests ---
  describe('parseJsonResponse', () => {
    it('should successfully parse and validate JSON', () => {
      const mockData = { status: 'ok' };
      mockSchema.parse.mockReturnValue(mockData);
      
      const rawText = 'Some response text\n```json\n{"status": "ok"}\n```';
      const result: ParseResult<typeof mockData> = parseJsonResponse(rawText, mockSchema);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockData);
      expect(result.rawText).toBe(rawText);
      expect(mockSchema.parse).toHaveBeenCalledWith({ status: 'ok' });
    });

    it('should handle JSON extraction failure and call warning callback', () => {
      const rawText = 'Some text without JSON.';
      const mockWarning = vi.fn();
      
      const result: ParseResult<any> = parseJsonResponse(rawText, mockSchema, mockWarning);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(mockWarning).toHaveBeenCalledWith('JSON extract failed, using default value', rawText);
    });

    it('should handle schema validation failure and call warning callback', () => {
      const mockData = { status: 'ok' };
      const parseError = new Error('Invalid data structure');
      mockSchema.parse.mockImplementation(() => {
        throw parseError; // Simulate validation failure
      });

      const rawText = '```json\n{"bad_key": 1}\n```';
      const mockWarning = vi.fn();

      const result: ParseResult<any> = parseJsonResponse(rawText, mockSchema, mockWarning);

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
      expect(mockWarning).toHaveBeenCalledWith('Schema validation failed, using default value', rawText);
    });
  });
});