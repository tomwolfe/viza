'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// TypeScript declarations for the Web Speech API
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
}

/**
 * Hook for voice interaction using native Web Speech API.
 * Handles SpeechRecognition (input) and SpeechSynthesis (output).
 */
export function useVoice(onTranscriptReady?: (transcript: string) => void): UseVoiceReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');

  // Initialize support check synchronously (only in browser)
  const [isSupported] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  });

  // Initialize error message if not supported
  const [error, setError] = useState<string | null>(() => {
    if (!isSupported) {
      return 'Speech recognition is not supported in this browser.';
    }
    return null;
  });

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const onTranscriptReadyRef = useRef(onTranscriptReady);

  // Keep callback ref up to date
  useEffect(() => {
    onTranscriptReadyRef.current = onTranscriptReady;
  }, [onTranscriptReady]);

  // Initialize SpeechRecognition on mount
  useEffect(() => {
    if (!isSupported) {
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Create recognition instance
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListeningRef.current = true;
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
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

      if (finalTranscript && onTranscriptReadyRef.current) {
        onTranscriptReadyRef.current(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[Voice] Speech recognition error:', event.error);
      isListeningRef.current = false;
      setIsListening(false);

      switch (event.error) {
        case 'no-speech':
          setError('No speech detected. Please try again.');
          break;
        case 'audio-capture':
          setError('No microphone found. Please ensure microphone is connected.');
          break;
        case 'not-allowed':
          setError('Microphone permission denied. Please allow microphone access.');
          break;
        case 'network':
          setError('Network error. Speech recognition requires an internet connection.');
          break;
        default:
          setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    // Cleanup
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore abort errors
        }
      }
    };
  }, []);

  /**
   * Start listening for voice input.
   */
  const startListening = useCallback(async (): Promise<void> => {
    if (!recognitionRef.current) {
      setError('Speech recognition is not available.');
      return;
    }

    // Stop any ongoing speech synthesis
    window.speechSynthesis.cancel();
    setIsSpeaking(false);

    try {
      setTranscript('');
      recognitionRef.current.start();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // If already started, stop and restart
      if (errorMessage.includes('already started')) {
        recognitionRef.current.stop();
        setTimeout(() => {
          try {
            recognitionRef.current?.start();
          } catch {
            console.error('[Voice] Failed to restart recognition');
          }
        }, 100);
      } else {
        console.error('[Voice] Failed to start recognition');
        setError('Failed to start speech recognition.');
      }
    }
  }, []);

  /**
   * Stop listening.
   */
  const stopListening = useCallback((): void => {
    if (recognitionRef.current && isListeningRef.current) {
      recognitionRef.current.stop();
    }
    isListeningRef.current = false;
    setIsListening(false);
  }, []);

  /**
   * Speak text aloud using SpeechSynthesis.
   */
  const speak = useCallback((text: string): void => {
    if (!window.speechSynthesis) {
      console.warn('[Voice] Speech synthesis not supported.');
      return;
    }

    // Cancel any ongoing speech
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
      console.error('[Voice] Speech synthesis error');
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  /**
   * Stop speaking.
   */
  const stopSpeaking = useCallback((): void => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  return {
    isListening,
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    isSupported,
    error,
  };
}
