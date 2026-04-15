import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVoice } from '../src/hooks/useVoice';

interface MockSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    isFinal: boolean;
    0: { transcript: string };
    length: number;
  }[];
}

interface MockSpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

const mockRecognitionInstance = {
  continuous: false,
  interimResults: true,
  lang: 'en-US',
  maxAlternatives: 1,
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onresult: null as ((event: MockSpeechRecognitionEvent) => void) | null,
  onerror: null as ((event: MockSpeechRecognitionErrorEvent) => void) | null,
  onend: null as (() => void) | null,
  onstart: null as (() => void) | null,
  onspeechend: null as (() => void) | null,
};

class MockSpeechRecognition {
  constructor() {
    return mockRecognitionInstance;
  }
}

class MockWebkitSpeechRecognition extends MockSpeechRecognition {}

describe('useVoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('SpeechRecognition', MockSpeechRecognition);
    vi.stubGlobal('webkitSpeechRecognition', MockWebkitSpeechRecognition);
    vi.stubGlobal('speechSynthesis', {
      cancel: vi.fn(),
      speak: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should report as supported in browser environment', () => {
    const { result } = renderHook(() => useVoice());
    expect(result.current.isSupported).toBe(true);
  });

  it('should initialize with default states', () => {
    const { result } = renderHook(() => useVoice());
    expect(result.current.isListening).toBe(false);
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.transcript).toBe('');
    expect(result.current.error).toBe(null);
  });

  it('should call onTranscriptReady when final transcript is received', async () => {
    const onTranscriptReady = vi.fn();
    renderHook(() => useVoice(onTranscriptReady));

    const mockEvent: MockSpeechRecognitionEvent = {
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'test command' },
          length: 1,
        },
      ],
    } as unknown as MockSpeechRecognitionEvent;

    mockRecognitionInstance.onresult?.(mockEvent);

    await waitFor(() => {
      expect(onTranscriptReady).toHaveBeenCalledWith('test command');
    });
  });

  it('should handle errors correctly', async () => {
    const { result } = renderHook(() => useVoice());

    const mockEvent: MockSpeechRecognitionErrorEvent = {
      error: 'not-allowed',
      message: 'Permission denied',
    } as unknown as MockSpeechRecognitionErrorEvent;

    mockRecognitionInstance.onerror?.(mockEvent);

    await waitFor(() => {
      expect(result.current.error).toBe('Microphone permission denied. Please allow microphone access.');
    });
  });

  it('should allow speaking text via SpeechSynthesis', () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      lang = 'en-US';
      rate = 1.0;
      pitch = 1.0;
      volume = 1.0;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
    });

    const { result } = renderHook(() => useVoice());
    
    result.current.speak('Hello world');
    
    expect(window.speechSynthesis?.speak).toHaveBeenCalled();
  });

  it('should stop speaking when stopSpeaking is called', () => {
    const { result } = renderHook(() => useVoice());
    
    result.current.stopSpeaking();
    
    expect(window.speechSynthesis?.cancel).toHaveBeenCalled();
  });

  it('should start listening when startListening is called', () => {
    const { result } = renderHook(() => useVoice());
    
    result.current.startListening();
    
    expect(mockRecognitionInstance.start).toHaveBeenCalled();
  });

  it('should stop listening when stopListening is called', () => {
    const { result } = renderHook(() => useVoice());
    
    mockRecognitionInstance.onstart?.();
    
    result.current.stopListening();
    
    expect(mockRecognitionInstance.stop).toHaveBeenCalled();
  });
});