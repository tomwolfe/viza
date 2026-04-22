'use client';

import { useCallback } from 'react';

export type VoiceIntentType =
  | 'cleaning'
  | 'planning'
  | 'reset_view'
  | 'reset_task'
  | 'repeat'
  | 'next_step'
  | 'previous_step'
  | 'skip'
  | 'help'
  | 'stop'
  | 'unknown';

export interface VoiceIntent {
  type: VoiceIntentType;
  confidence: number;
  targetObject?: string;
  reason: string;
}

const INTENT_PATTERNS: Record<VoiceIntentType, RegExp[]> = {
  cleaning: [
    /clean/i,
    /organize/i,
    /trash/i,
    /garbage/i,
    /mess/i,
    /tidy/i,
    /put away/i,
    /sort/i,
  ],
  planning: [
    /plan/i,
    /what.*need/i,
    /steps?/i,
    /what.*do/i,
    /create.*task/i,
  ],
  reset_view: [
    /reset view/i,
    /refresh/i,
    /rescan/i,
    /scan again/i,
    /look again/i,
    /clear.*view/i,
    /start over/i,
  ],
  reset_task: [
    /the plan is wrong/i,
    /wrong plan/i,
    /reset task/i,
    /new task/i,
    /clear task/i,
    /cancel task/i,
  ],
  repeat: [
    /repeat/i,
    /say again/i,
    /what.*said/i,
    /again/i,
  ],
  next_step: [
    /next/i,
    /done/i,
    /complete/i,
    /finished/i,
    /moving on/i,
    /proceed/i,
  ],
  previous_step: [
    /go back/i,
    /previous/i,
    /back up/i,
    /before/i,
    /undo/i,
  ],
  skip: [
    /skip/i,
    /skip.*step/i,
    /skip this/i,
    /skip ahead/i,
  ],
  help: [
    /help/i,
    /hint/i,
    /stuck/i,
    /what now/i,
    /what.*do/i,
    /not sure/i,
  ],
  stop: [
    /stop/i,
    /pause/i,
    /wait/i,
    /hold on/i,
  ],
  unknown: [],
};

function matchIntent(transcript: string): VoiceIntent {
  const _transcriptLower = transcript.toLowerCase();

  for (const [intentType, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intentType === 'unknown') continue;

    for (const pattern of patterns) {
      if (pattern.test(transcript)) {
        let targetObject: string | undefined;

        const objectMatch = transcript.match(/(?:to|of|the)\s+(\w+)/i);
        if (objectMatch) {
          targetObject = objectMatch[1];
        }

        return {
          type: intentType as VoiceIntentType,
          confidence: 0.8,
          targetObject,
          reason: `Matched pattern: ${pattern.source}`,
        };
      }
    }
  }

  return {
    type: 'unknown',
    confidence: 0,
    reason: 'No intent pattern matched',
  };
}

export function useVoiceIntent() {
  const isCleaningIntent = useCallback((transcript: string) => {
    const intent = matchIntent(transcript);
    return intent.type === 'cleaning';
  }, []);

  const detectIntent = useCallback((transcript: string): VoiceIntent => {
    return matchIntent(transcript);
  }, []);

  const shouldResetView = useCallback((transcript: string): boolean => {
    const intent = matchIntent(transcript);
    return intent.type === 'reset_view';
  }, []);

  const shouldResetTask = useCallback((transcript: string): boolean => {
    const intent = matchIntent(transcript);
    return intent.type === 'reset_task';
  }, []);

  const isHelpIntent = useCallback((transcript: string): boolean => {
    const intent = matchIntent(transcript);
    return intent.type === 'help';
  }, []);

  const isNavigationIntent = useCallback((transcript: string): boolean => {
    const intent = matchIntent(transcript);
    return ['next_step', 'previous_step', 'skip'].includes(intent.type);
  }, []);

  const getNavigationAction = useCallback((transcript: string): 'next' | 'previous' | 'skip' | null => {
    const intent = matchIntent(transcript);
    if (intent.type === 'next_step') return 'next';
    if (intent.type === 'previous_step') return 'previous';
    if (intent.type === 'skip') return 'skip';
    return null;
  }, []);

  return {
    isCleaningIntent,
    detectIntent,
    shouldResetView,
    shouldResetTask,
    isHelpIntent,
    isNavigationIntent,
    getNavigationAction,
  };
}
