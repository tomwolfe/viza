'use client';

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ARScene } from '@/components/ARScene';
import AROverlay from '@/components/AROverlay';
import ARControls from '@/components/ARControls';
import { useAROrchestrator } from '@/hooks/useAROrchestrator';
import { SpatialProvider } from '@/contexts/SpatialContext';
import { TaskProvider } from '@/contexts/TaskContext';
import { WebLLMProvider } from '@/contexts/WebLLMContext';

export function ARContent() {
  const [showWarnings, setShowWarnings] = useState(true);
  const { handleStartAR, dispatchActions, isARActive, isXRMode, sceneImageRef } = useAROrchestrator();

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

      <WebLLMProvider>
        <SpatialProvider>
          <TaskProvider webllmInitModel={dispatchActions.initModel}>
            <ErrorBoundary>
              <Canvas
                camera={{ position: [0, 0, 0], fov: 75 }}
                style={{ width: '100%', height: '100%' }}
                gl={{ preserveDrawingBuffer: true }}
              >
                {isARActive ? (
                  <ARScene
                    isARActive={isARActive}
                    isModelReady={true}
                    runInference={undefined as any}
                    detectedObjects={[]}
                    worldObjects={[]}
                    onObjectsDetected={undefined as any}
                    taskActive={false}
                    currentStepTarget={undefined}
                    checkTargetFound={undefined as any}
                    speak={undefined as any}
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
              onVoiceInput={() => {}}
              isARActive={isARActive}
              isModelLoading={false}
              modelProgress={0}
              isListening={false}
              isDeviceIncompatible={false}
              unifiedErrorCode={null}
              unifiedError={null}
              errorCode={null}
              error={null}
            />

            <AROverlay
              transcript=""
              isPlanning={false}
              taskState={{ isActive: false, completed: false, currentStepIndex: 0, steps: [] }}
              currentInstruction=""
              detectedObjects={[]}
              isSpeaking={false}
              isInferring={false}
              llmError={null}
              voiceError={null}
              appError={null}
              isARActive={isARActive}
            />
          </TaskProvider>
        </SpatialProvider>
      </WebLLMProvider>
    </main>
  );
}