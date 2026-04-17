'use client';

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ARScene } from '@/components/ARScene';
import AROverlay from '@/components/AROverlay';
import ARControls from '@/components/ARControls';
import { useAROrchestrator } from '@/hooks/useAROrchestrator';

export function ARContent() {
  const [showWarnings, setShowWarnings] = useState(true);

  const {
    isARActive,
    error,
    errorCode,
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    runInference,
    taskState,
    isPlanning,
    checkTargetFound,
    isListening,
    isSpeaking,
    transcript,
    speak,
    voiceError,
    llmError,
    detectedObjects,
    handleStartAR,
    handleVoiceInput,
    handleObjectsDetected,
    currentInstruction,
    voiceCommandRef,
    sceneImageRef,
    isXRMode,
  } = useAROrchestrator();

  const unifiedError = error;
  const unifiedErrorCode = errorCode;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black">
      {showWarnings && !isARActive && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-amber-900/90 backdrop-blur-md text-white rounded-lg p-4">
          <p className="text-sm font-semibold mb-2">System Requirements</p>
          <ul className="text-xs space-y-1">
            <li>- Wi-Fi recommended (~2.3GB model download)</li>
            <li>- High battery usage expected during inference</li>
            <li>- 8GB+ RAM required for optimal performance</li>
          </ul>
          <button
            onClick={() => setShowWarnings(false)}
            className="mt-3 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded"
          >
            Acknowledge
          </button>
        </div>
      )}

      <ErrorBoundary>
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
              voiceCommandRef={voiceCommandRef}
              taskActive={taskState.isActive}
              currentStepTarget={taskState.steps[taskState.currentStepIndex]?.targetObject}
              checkTargetFound={checkTargetFound}
              speak={speak}
              isXRMode={isXRMode}
              sceneImageRef={sceneImageRef}
            />
          ) : (
            <color attach="background" args={['#1a1a1a']} />
          )}
        </Canvas>
      </ErrorBoundary>

      <ARControls
        onStartAR={handleStartAR}
        onVoiceInput={handleVoiceInput}
        isARActive={isARActive}
        isModelLoading={isModelLoading}
        modelProgress={modelProgress}
        isListening={isListening}
        isDeviceIncompatible={!isDeviceCompatible}
        unifiedErrorCode={unifiedErrorCode}
        unifiedError={unifiedError}
        errorCode={errorCode}
        error={error}
      />

      <AROverlay
        transcript={transcript}
        isPlanning={isPlanning}
        taskState={taskState}
        currentInstruction={currentInstruction ?? ''}
        detectedObjects={detectedObjects}
        isSpeaking={isSpeaking}
        isInferring={isInferring}
        llmError={llmError}
        voiceError={voiceError}
        appError={error}
        isARActive={isARActive}
      />
    </main>
  );
}