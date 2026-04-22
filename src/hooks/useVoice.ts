'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { logger } from '@/config';
import type { VizaErrorCode } from '@/types/worker';
import type { 
  SpeechRecognitionEvent, 
  SpeechRecognitionErrorEvent, 
  SpeechRecognitionInstance 
} from '@/types/speech';

type VoiceStatus = 'idle' | 'listening' | 'starting';

interface SpatialQueryHandler {
  getWorldMapObjects: () => { name: string; position?: { x: number; y: number; z: number }; lastSeen?: number }[];
  highlightObject: (name: string) => void;
  getCameraDirection: () => { x: number; y: number; z: number } | null;
}

interface UseVoiceReturn {
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  isSupported: boolean;
  error: string | null;
  errorCode: VizaErrorCode | null;
  setSpatialQueryHandler: (handler: SpatialQueryHandler | null) => void;
  lastQueryType: 'command' | 'spatial_query' | 'none';
}

export function useVoice(onCommand?: (transcript: string) => void): UseVoiceReturn {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');

  const onCommandRef = useRef(onCommand);

  const [isSupported] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  });

  const [error, setError] = useState<string | null>(() => {
    if (!isSupported) {
      return 'Speech recognition is not supported in this browser.';
    }
    return null;
  });
  const [errorCode, setErrorCode] = useState<VizaErrorCode | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldRestartRef = useRef(false);
  const isIntendingToListenRef = useRef(false);
  const spatialQueryHandlerRef = useRef<SpatialQueryHandler | null>(null);
  const [lastQueryType, setLastQueryType] = useState<'command' | 'spatial_query' | 'none'>('none');

  const SPATIAL_QUERY_PATTERNS = useMemo(() => [
    /where.*(is|was|are|were)\s+(the\s+)?(\w+)/i,
    /where.*did.*see\s+(the\s+)?(\w+)/i,
    /where.*(\w+)\s+located/i,
    /where.*(\w+)\s+position/i,
    /how.*far.*(\w+)/i,
    /direction.*(\w+)/i,
    /where.*should.*look/i,
    /point.*to.*(\w+)/i,
  ], []);

 useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  const speak = useCallback((text: string): void => {
    if (!window.speechSynthesis) {
      logger.warn('[Voice] Speech synthesis not supported.');
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
    };

    utterance.onerror = () => {
      logger.error('[Voice] Speech synthesis error');
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const handleSpatialQuery = useCallback((query: string) => {
    const handler = spatialQueryHandlerRef.current;
    if (!handler) return;

    const _queryLower = query.toLowerCase();
    let targetName = '';
    let _isDirectionQuery = false;
    let isDistanceQuery = false;

    for (const pattern of SPATIAL_QUERY_PATTERNS) {
      const match = query.match(pattern);
      if (match) {
        targetName = match[match.length - 1] || '';
        if (query.includes('direction') || query.includes('point')) {
          _isDirectionQuery = true;
        }
        if (query.includes('far')) {
          isDistanceQuery = true;
        }
        break;
      }
    }

    if (!targetName) {
      targetName = query.replace(/where|is|was|are|were|did|see|how|far|direction|point|to|the|a|an/gi, '').trim();
    }

    if (!targetName) return;

    const worldObjects = handler.getWorldMapObjects();
    const matchingObjects = worldObjects.filter(obj => 
      obj.name.toLowerCase().includes(targetName.toLowerCase())
    );

    if (matchingObjects.length === 0) {
      speak(`I don't remember seeing a ${targetName}. Try scanning the room to let me see it.`);
      return;
    }

    const obj = matchingObjects[0];
    const _cameraDir = handler.getCameraDirection();

    if (isDistanceQuery && obj.position) {
      const dist = Math.sqrt(
        (obj.position.x || 0) ** 2 + 
        (obj.position.y || 0) ** 2 + 
        (obj.position.z || 0) ** 2
      );
      speak(`The ${obj.name} is about ${dist.toFixed(1)} meters away.`);
      return;
    }

    if (obj.position) {
      const dirX = obj.position.x > 0.5 ? 'to your right' : 
                  obj.position.x < -0.5 ? 'to your left' : 
                  'straight ahead';
      const dirY = obj.position.y > 0.5 ? 'above you' : 
                   obj.position.y < -0.5 ? 'below you' : '';
      const dirZ = obj.position.z > 0 ? 'behind you' : 'in front';

      const response = `The ${obj.name} is ${dirX}${dirY ? ', ' + dirY : ''}. Try looking ${dirZ}.`;
      speak(response);
      
      handler.highlightObject(targetName);
    } else {
      speak(`I saw the ${obj.name} earlier, but I don't have its exact position. Try looking around.`);
      handler.highlightObject(targetName);
    }
  }, [SPATIAL_QUERY_PATTERNS, speak]);

  const handleResult = useCallback((event: SpeechRecognitionEvent) => {
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    const transcriptText = (finalTranscript || interimTranscript).trim();
    setTranscript(transcriptText);

    if (!finalTranscript) return;

    if (spatialQueryHandlerRef.current && transcriptText) {
      handleSpatialQuery(transcriptText);
      setLastQueryType('spatial_query');
      return;
    }

    setLastQueryType('command');
    if (onCommandRef.current) {
      onCommandRef.current(transcriptText);
    }
  }, [handleSpatialQuery]);

  const handleError = useCallback((event: SpeechRecognitionErrorEvent) => {
    logger.error('[Voice] Speech recognition error:', event.error);
    setStatus('idle');

    switch (event.error) {
      case 'no-speech':
        setError('No speech detected. Please try again.');
        setErrorCode('NO_SPEECH_DETECTED');
        break;
      case 'audio-capture':
        setError('No microphone found. Please ensure microphone is connected.');
        setErrorCode('MICROPHONE_NOT_FOUND');
        break;
      case 'not-allowed':
        setError('Microphone permission denied. Please allow microphone access.');
        setErrorCode('MICROPHONE_NOT_ALLOWED');
        break;
      case 'network':
        setError('Speech recognition network error. Check connection or try again later.');
        setErrorCode('VOICE_ERROR');
        break;
      default:
        setError(`Speech recognition error: ${event.error}`);
        setErrorCode('VOICE_ERROR');
    }
  }, []);

  const handleEnd = useCallback(() => {
    setStatus('idle');
    if (shouldRestartRef.current && isIntendingToListenRef.current) {
      shouldRestartRef.current = false;
      try {
        recognitionRef.current?.start();
      } catch (e) {
        logger.debug('[Voice] Auto-restart failed:', e);
      }
    }
  }, []);

  const handleStart = useCallback(() => {
    setStatus('listening');
    setError(null);
  }, []);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = handleStart;
    recognition.onresult = handleResult;
    recognition.onerror = handleError;
    recognition.onend = handleEnd;

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          logger.debug('[Voice] Abort ignored during cleanup:', e);
        }
      }
    };
  }, [isSupported, handleStart, handleResult, handleError, handleEnd]);

  const startListening = useCallback(async (): Promise<void> => {
    if (!recognitionRef.current) {
      setError('Speech recognition is not available.');
      return;
    }

    if (status !== 'idle') {
      return;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setStatus('starting');
    isIntendingToListenRef.current = true;
    shouldRestartRef.current = false;

    try {
      setTranscript('');
      recognitionRef.current.start();
    } catch (err: unknown) {
      isIntendingToListenRef.current = false;
      setStatus('idle');
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('already started')) {
        shouldRestartRef.current = true;
        try {
          recognitionRef.current.stop();
        } catch (e) {
          logger.debug('[Voice] Stop failed during restart handling:', e);
        }
      } else {
        logger.error('[Voice] Failed to start recognition');
        setError('Failed to start speech recognition.');
      }
    }
  }, [status]);

  const stopListening = useCallback((): void => {
    isIntendingToListenRef.current = false;
    shouldRestartRef.current = false;
    if (recognitionRef.current && status === 'listening') {
      recognitionRef.current.stop();
    }
    setStatus('idle');
  }, [status]);

  const stopSpeaking = useCallback((): void => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const setSpatialQueryHandler = useCallback((handler: SpatialQueryHandler | null) => {
    spatialQueryHandlerRef.current = handler;
  }, []);

  return {
    isListening: status === 'listening',
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    isSupported,
    error,
    errorCode,
    setSpatialQueryHandler,
    lastQueryType,
  };
}