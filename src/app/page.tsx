'use client';

import { Canvas } from '@react-three/fiber';
import { useState, useEffect, useCallback } from 'react';
import ARControls from '@/components/ARControls';
import { ARScene, PlaceholderScene } from '@/components/ARScene';
import { WebLLMProvider, useWebLLM } from '@/contexts/WebLLMContext';
import { useVoice } from '@/hooks/useVoice';
import type { DetectedObject } from '@/hooks/useWebLLM';

function ARContent() {
  const [isARActive, setIsARActive] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [voiceCommand, setVoiceCommand] = useState<string | null>(null);
  
  const {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    initModel,
    runInference,
    error: llmError,
  } = useWebLLM();

  const handleTranscriptReady = useCallback((transcript: string) => {
    setVoiceCommand(transcript);
  }, []);

  const {
    isListening,
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    error: voiceError,
  } = useVoice(handleTranscriptReady);

  const handleStartAR = useCallback(async () => {
    try {
      if (!isModelReady) {
        initModel();
      }

      setIsARActive(true);
    } catch (error) {
      console.error('Failed to start AR:', error);
      alert('Failed to start AR session');
    }
  }, [isModelReady, initModel]);

  const handleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleObjectsDetected = useCallback((objects: DetectedObject[]) => {
    setDetectedObjects(objects);

    const actions = objects
      .filter(obj => obj.action)
      .map(obj => `${obj.name}: ${obj.action}`)
      .join('. ');

    if (actions) {
      speak(actions);
    }
  }, [speak]);

  useEffect(() => {
    if (llmError) {
      console.error('[App] WebLLM Error:', llmError);
    }
  }, [llmError]);

  useEffect(() => {
    if (voiceError) {
      console.warn('[App] Voice Error:', voiceError);
    }
  }, [voiceError]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black">
      <Canvas
        camera={{ position: [0, 0, 0], fov: 75 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ preserveDrawingBuffer: true }}
      >
        {isARActive ? (
          <ARScene
            isARActive={isARActive}
            isModelReady={isModelReady}
            runInference={runInference}
            detectedObjects={detectedObjects}
            onObjectsDetected={handleObjectsDetected}
            voiceCommand={voiceCommand}
          />
        ) : (
          <PlaceholderScene />
        )}
      </Canvas>

      <ARControls
        onStartAR={handleStartAR}
        onVoiceInput={handleVoiceInput}
        isARActive={isARActive}
        isModelLoading={isModelLoading}
        modelProgress={modelProgress}
        isListening={isListening}
        isDeviceIncompatible={!isDeviceCompatible}
      />

      {transcript && isARActive && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 
                        bg-white/10 backdrop-blur-md text-white rounded-lg px-6 py-3 max-w-md">
          <p className="text-sm italic">&ldquo;{transcript}&rdquo;</p>
        </div>
      )}

      {detectedObjects.length > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 
                        bg-green-900/80 backdrop-blur-md text-white rounded-lg px-4 py-2">
          <p className="text-xs">{detectedObjects.length} object(s) detected</p>
        </div>
      )}

      {isSpeaking && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 
                        bg-blue-900/80 backdrop-blur-md text-white rounded-lg px-6 py-3">
          <p className="text-sm">Speaking...</p>
        </div>
      )}

      {isInferring && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 
                        bg-blue-900/80 backdrop-blur-md text-white rounded-lg px-6 py-3">
          <p className="text-sm">Analyzing scene...</p>
        </div>
      )}

      {(llmError || voiceError) && (
        <div className="fixed bottom-4 left-4 right-4 z-50 bg-red-900/80 backdrop-blur-md 
                        text-white rounded-lg p-4">
          <p className="text-sm font-semibold">Error</p>
          <p className="text-xs mt-1">{llmError || voiceError}</p>
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <WebLLMProvider>
      <ARContent />
    </WebLLMProvider>
  );
}