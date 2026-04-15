import { logger } from '@/config';

export interface ParseResult<T> {
  success: boolean;
  data: T | null;
  rawText?: string;
}

export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      logger.debug('[ResponseParser] Code block JSON parse failed');
    }
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonCandidate);
    } catch {
      logger.debug('[ResponseParser] Fallback JSON parse failed');
    }
  }
  return null;
}

export function parseJsonResponse<T>(
  rawText: string,
  schema: { parse: (input: unknown) => T },
  onWarning?: (message: string, rawText: string) => void
): ParseResult<T> {
  const extracted = extractJsonFromText(rawText);

  if (!extracted) {
    onWarning?.('JSON extract failed, using default value', rawText);
    return { success: false, data: null, rawText };
  }

  try {
    const validated = schema.parse(extracted);
    return { success: true, data: validated, rawText };
  } catch (parseError) {
    logger.debug('[ResponseParser] Schema validation failed:', parseError);
    onWarning?.('Schema validation failed, using default value', rawText);
    return { success: false, data: null, rawText };
  }
}