'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '@/config';
import type { VizaErrorCode } from '@/types/worker';

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

type VoiceStatus = 'idle' | 'listening' | 'starting';

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

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

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

    setTranscript(finalTranscript || interimTranscript);

    if (finalTranscript && onCommandRef.current) {
      onCommandRef.current(finalTranscript.trim());
    }
  }, []);

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

    window.speechSynthesis.cancel();
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
        } catch {
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

  const stopSpeaking = useCallback((): void => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
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
  };
}