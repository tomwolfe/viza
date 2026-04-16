'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useWebLLM } from '@/contexts/WebLLMContext';
import { useVoice } from '@/hooks/useVoice';
import { useTaskState, DEFAULT_ASSEMBLY_TASK, type TaskStep } from '@/hooks/useTaskState';
import type { DetectedObject } from '@/schemas/vision';
import { logger } from '@/config';
import { ARScene } from '@/components/ARScene';
import AROverlay from '@/components/AROverlay';
import ARControls from '@/components/ARControls';

export function ARContent() {
  const [isARActive, setIsARActive] = useState(false);
  const [showWarnings, setShowWarnings] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    isModelLoading,
    modelProgress,
    isModelReady,
    isInferring,
    isDeviceCompatible,
    initModel,
    runInference,
    runPlanningInference,
    error: llmError,
    lastCompleted,
  } = useWebLLM();

  const {
    taskState,
    startTask,
    generateTaskPlan,
    completeCurrentStep,
    getCurrentInstruction,
    setSpeak,
    isPlanning,
    checkTargetFound,
  } = useTaskState();

  const sceneImageRef = useRef<ImageBitmap | null>(null);
  const voiceCommandRef = useRef<string | null>(null);

  const generatePlanFromGoal = useCallback(async (goal: string): Promise<TaskStep[]> => {
    if (!sceneImageRef.current) {
      logger.warn('[App] No scene image available for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }

    try {
      const steps = await runPlanningInference(sceneImageRef.current, goal);
      if (steps && steps.length > 0) {
        return steps;
      }
    } catch (error) {
      logger.error('[App] Planning inference failed:', error);
    }
    return DEFAULT_ASSEMBLY_TASK;
  }, [runPlanningInference]);

  const triggerPlanningMode = useCallback(async (userGoal: string) => {
    if (!isModelReady || isPlanning) return;

    await generateTaskPlan(userGoal, sceneImageRef.current!, generatePlanFromGoal);
  }, [isModelReady, isPlanning, generateTaskPlan, generatePlanFromGoal]);

  const handleTranscriptReady = useCallback((transcript: string) => {
    voiceCommandRef.current = transcript;

    if (isModelReady && !taskState.isActive) {
      const isCleaningGoal = /clean|organize|trash|garbage|mess|fix|help/i.test(transcript);
      if (isCleaningGoal) {
        triggerPlanningMode(transcript);
        voiceCommandRef.current = null;
        return;
      }
    }

    voiceCommandRef.current = null;
  }, [isModelReady, taskState.isActive, triggerPlanningMode]);

  const {
    isListening,
    isSpeaking,
    transcript,
    startListening,
    stopListening,
    speak,
    error: voiceError,
  } = useVoice(handleTranscriptReady);

  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);

  useEffect(() => {
    setSpeak(speak);
  }, [speak, setSpeak]);

  const handleStartAR = useCallback(async () => {
    try {
      if (!isModelReady) {
        initModel();
      }

      startTask('Assembly Task', DEFAULT_ASSEMBLY_TASK);
      setIsARActive(true);
      setShowWarnings(false);
      setError(null);
    } catch (err) {
      logger.error('Failed to start AR:', err);
      setError('Failed to start AR session. Please refresh and try again.');
    }
  }, [isModelReady, initModel, startTask]);

  const handleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleObjectsDetected = useCallback((objects: DetectedObject[]) => {
    setDetectedObjects(objects);
  }, []);

  useEffect(() => {
    if (llmError) {
      logger.error('[App] WebLLM Error:', llmError);
    }
  }, [llmError]);

  useEffect(() => {
    if (voiceError) {
      logger.warn('[App] Voice Error:', voiceError);
    }
  }, [voiceError]);

  useEffect(() => {
    if (lastCompleted && taskState.isActive && !taskState.completed) {
      completeCurrentStep();
    }
  }, [lastCompleted, taskState.isActive, taskState.completed, completeCurrentStep]);

  const currentInstruction = getCurrentInstruction();

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
      />

      <AROverlay
        transcript={transcript}
        isPlanning={isPlanning}
        taskState={taskState}
        currentInstruction={currentInstruction}
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