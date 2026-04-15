'use client';

import { Canvas } from '@react-three/fiber';
import { useState, useEffect, useCallback } from 'react';
import ARControls from '@/components/ARControls';
import { ARScene, PlaceholderScene } from '@/components/ARScene';
import { useWebLLM, type DetectedObject } from '@/hooks/useWebLLM';
import { useVoice } from '@/hooks/useVoice';

export default function Home() {
  const [isARActive, setIsARActive] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  
  // WebLLM hook manages model loading and inference
  const {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    initModel,
    runInference,
    error: llmError,
  } = useWebLLM();

  // Voice hook handles speech recognition and synthesis
  const handleTranscriptReady = useCallback((transcript: string) => {
    console.log('[App] Voice transcript:', transcript);
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
      // Initialize the AI model first
      if (!isModelReady) {
        initModel();
      }

      // Request AR session (CameraFallback handles WebXR vs getUserMedia)
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

    // Speak the detected actions aloud
    const actions = objects
      .filter(obj => obj.action)
      .map(obj => `${obj.name}: ${obj.action}`)
      .join('. ');

    if (actions) {
      speak(actions);
    }
  }, [speak]);

  // Show error from WebLLM if any
  useEffect(() => {
    if (llmError) {
      console.error('[App] WebLLM Error:', llmError);
    }
  }, [llmError]);

  // Show voice error if any
  useEffect(() => {
    if (voiceError) {
      console.warn('[App] Voice Error:', voiceError);
    }
  }, [voiceError]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black">
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 0, 0], fov: 75 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ preserveDrawingBuffer: true }} // Needed for frame capture
      >
        {isARActive ? (
          <ARScene
            isARActive={isARActive}
            isModelReady={isModelReady}
            runInference={runInference}
            detectedObjects={detectedObjects}
            onObjectsDetected={handleObjectsDetected}
          />
        ) : (
          <PlaceholderScene />
        )}
      </Canvas>

      {/* UI Overlay */}
      <ARControls
        onStartAR={handleStartAR}
        onVoiceInput={handleVoiceInput}
        isARActive={isARActive}
        isModelLoading={isModelLoading}
        modelProgress={modelProgress}
        isListening={isListening}
      />

      {/* Voice Transcript Display */}
      {transcript && isARActive && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 
                        bg-white/10 backdrop-blur-md text-white rounded-lg px-6 py-3 max-w-md">
          <p className="text-sm italic">&ldquo;{transcript}&rdquo;</p>
        </div>
      )}

      {/* Detected Objects Count */}
      {detectedObjects.length > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 
                        bg-green-900/80 backdrop-blur-md text-white rounded-lg px-4 py-2">
          <p className="text-xs">{detectedObjects.length} object(s) detected</p>
        </div>
      )}

      {/* Speaking Status */}
      {isSpeaking && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 
                        bg-blue-900/80 backdrop-blur-md text-white rounded-lg px-6 py-3">
          <p className="text-sm">🔊 Speaking...</p>
        </div>
      )}

      {/* Inference Status */}
      {isInferring && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 
                        bg-blue-900/80 backdrop-blur-md text-white rounded-lg px-6 py-3">
          <p className="text-sm">🧠 Analyzing scene...</p>
        </div>
      )}

      {/* Error Display */}
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
