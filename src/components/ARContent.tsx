'use client';

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ARScene } from '@/components/ARScene';
import AROverlay from '@/components/AROverlay';
import ARControls from '@/components/ARControls';
import { useAROrchestrator } from '@/hooks/useAROrchestrator';
import { TaskProvider } from '@/contexts/TaskContext';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useSpatial } from '@/contexts/SpatialContext';
import { useTaskContext } from '@/contexts/TaskContext';

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

      <TaskProvider webllmInitModel={dispatchActions.initModel}>
        <ErrorBoundary>
          <Canvas
            camera={{ position: [0, 0, 0], fov: 75 }}
            style={{ width: '100%', height: '100%' }}
            gl={{ preserveDrawingBuffer: true }}
          >
            {isARActive ? (
              <ARContentCanvas
                isXRMode={isXRMode}
                sceneImageRef={sceneImageRef}
              />
            ) : (
              <color attach="background" args={['#1a1a1a']} />
            )}
          </Canvas>
        </ErrorBoundary>

        <ARControlsWrapper onStartAR={handleStartAR} />
        <AROverlayWrapper isARActive={isARActive} />
      </TaskProvider>
    </main>
  );
}

function ARContentCanvas({ isXRMode, sceneImageRef }: { isXRMode: boolean; sceneImageRef: React.MutableRefObject<ImageBitmap | null> }) {
  const { isModelReady } = useWebLLM();
  const { detectedObjects, worldObjects } = useSpatial();

  return (
    <ARScene
      isARActive={true}
      isModelReady={isModelReady}
      detectedObjects={detectedObjects || []}
      worldObjects={worldObjects || []}
      isXRMode={isXRMode}
      sceneImageRef={sceneImageRef}
    />
  );
}

function ARControlsWrapper({ onStartAR }: { onStartAR: () => void }) {
  const { isInferring, isModelReady, isDeviceCompatible } = useWebLLM();
  const { isARActive } = useAROrchestrator();
  const modelProgress = 0;
  const isIncompatible = isDeviceCompatible === false;

  return (
    <ARControls
      onStartAR={onStartAR}
      onVoiceInput={() => {}}
      isARActive={isARActive}
      isModelLoading={!isModelReady && isInferring}
      modelProgress={modelProgress}
      isListening={false}
      isDeviceIncompatible={isIncompatible}
    />
  );
}

function AROverlayWrapper({ isARActive }: { isARActive: boolean }) {
  const { detectedObjects } = useSpatial();
  const { isInferring, error: llmError } = useWebLLM();
  const { transcript, isPlanning, taskState, currentInstruction, isSpeaking, voiceError, voiceErrorCode } = useTaskContext();

  return (
    <AROverlay
      transcript={transcript}
      isPlanning={isPlanning}
      taskState={taskState}
      currentInstruction={currentInstruction || ''}
      detectedObjects={detectedObjects}
      isSpeaking={isSpeaking}
      isInferring={isInferring}
      llmError={llmError}
      voiceError={voiceError}
      appError={null}
      isARActive={isARActive}
    />
  );
}