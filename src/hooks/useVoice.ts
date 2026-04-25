'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { logger } from '@/config';
import type { VizaErrorCode } from '@/types/worker';
import { pipeline, env } from '@huggingface/transformers';

// Disable local model loading — use HuggingFace Hub CDN
env.allowLocalModels = false;
env.allowRemoteModels = true;

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

const MODEL_ID = 'onnx-community/whisper-tiny.en';

export function useVoice(onCommand?: (transcript: string) => void): UseVoiceReturn {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VizaErrorCode | null>(null);
  const [lastQueryType, setLastQueryType] = useState<'command' | 'spatial_query' | 'none'>('none');

  const onCommandRef = useRef(onCommand);
  const spatialQueryHandlerRef = useRef<SpatialQueryHandler | null>(null);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setIsSupported(false);
      setError('Audio input not supported in this environment.');
      return;
    }
  }, []);

  const pipelineRef = useRef<any>(null);
  const isLoadedRef = useRef(false);
  const loadingRef = useRef(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const isRunningRef = useRef(false);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const loadModel = useCallback(async () => {
    if (loadingRef.current || isLoadedRef.current) {
      return;
    }

    loadingRef.current = true;

    try {
      const pipe = await pipeline('automatic-speech-recognition', MODEL_ID, {
        device: 'webgpu',
        dtype: 'fp16',
      });

      pipelineRef.current = pipe;
      isLoadedRef.current = true;
      loadingRef.current = false;

      logger.info('[Voice] Whisper WebGPU loaded:', MODEL_ID);
    } catch (err) {
      loadingRef.current = false;
      logger.error('[Voice] WebGPU failed, falling back to WASM:', err);
      try {
        const pipe = await pipeline('automatic-speech-recognition', MODEL_ID);
        pipelineRef.current = pipe;
        isLoadedRef.current = true;
        loadingRef.current = false;
        logger.info('[Voice] Whisper WASM loaded:', MODEL_ID);
      } catch (fallbackErr) {
        logger.error('[Voice] WASM fallback also failed:', fallbackErr);
        setError('Failed to load speech recognition model.');
        setErrorCode('VOICE_ERROR');
      }
    }
  }, []);

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

  const startListening = useCallback(async (): Promise<void> => {
    if (status !== 'idle') {
      return;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setStatus('starting');
    setTranscript('');
    chunksRef.current = [];

    try {
      if (!isLoadedRef.current) {
        await loadModel();
      }

      if (!isLoadedRef.current) {
        setError('Failed to load speech recognition model.');
     setErrorCode('VOICE_ERROR');
        setStatus('idle');
        return;
      }

     const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);

      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!isRunningRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setStatus('listening');
      setError(null);
      isRunningRef.current = true;

      const timeoutId = setTimeout(() => {
        isRunningRef.current = false;
        processor.disconnect();
        source.disconnect();
        if (audioContext) {
          audioContext.close();
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
        }

        const audioData = chunksRef.current;
        const totalLength = audioData.reduce((acc, chunk) => acc + chunk.length, 0);
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of audioData) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        if (pipelineRef.current && combined.length > 0) {
          pipelineRef.current(combined, {
            chunk_length_s: 30,
            stride_length_s: 5,
          }).then((result: any) => {
            const text = typeof result === 'string' ? result : result.text || '';
            setTranscript(text);

            if (text) {
              if (spatialQueryHandlerRef.current) {
                handleSpatialQuery(text);
                setLastQueryType('spatial_query');
              } else {
                setLastQueryType('command');
                if (onCommandRef.current) {
                  onCommandRef.current(text);
                }
              }
            }

            setStatus('idle');
          }).catch((err: unknown) => {
            logger.error('[Voice] Transcription failed:', err);
            setError('Transcription failed.');
            setErrorCode('VOICE_ERROR');
            setStatus('idle');
          });
        }

        clearTimeout(timeoutId);
      }, 15000);

      const cleanup = () => {
        isRunningRef.current = false;
        processor.disconnect();
        source.disconnect();
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close();
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
        }
        clearTimeout(timeoutId);
      };

      stopListenCleanupRef.current = cleanup;

    } catch (err: unknown) {
      setStatus('idle');
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('Microphone not found.');
        setErrorCode('MICROPHONE_NOT_FOUND');
      } else if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Microphone permission denied.');
        setErrorCode('MICROPHONE_NOT_ALLOWED');
      } else {
        setError('Failed to start listening.');
        setErrorCode('VOICE_ERROR');
      }
    }
  }, [status, loadModel, handleSpatialQuery]);

  const stopListenCleanupRef = useRef<(() => void) | null>(null);

  const stopListening = useCallback((): void => {
    setStatus('idle');

    if (stopListenCleanupRef.current) {
      stopListenCleanupRef.current();
      stopListenCleanupRef.current = null;

      const audioData = chunksRef.current;
      const totalLength = audioData.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of audioData) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      if (pipelineRef.current && combined.length > 0) {
        pipelineRef.current(combined, {
          chunk_length_s: 30,
          stride_length_s: 5,
        }).then((result: any) => {
          const text = typeof result === 'string' ? result : result.text || '';
          setTranscript(text);

          if (text) {
            if (spatialQueryHandlerRef.current) {
              handleSpatialQuery(text);
              setLastQueryType('spatial_query');
            } else {
              setLastQueryType('command');
              if (onCommandRef.current) {
                onCommandRef.current(text);
              }
            }
          }
        }).catch((err: unknown) => {
          logger.error('[Voice] Transcription failed:', err);
          setError('Transcription failed.');
          setErrorCode('VOICE_ERROR');
        });
      }
    }
  }, [handleSpatialQuery]);

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
