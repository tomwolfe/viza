'use client';

import { Canvas } from '@react-three/fiber';
import { useState, useEffect, useCallback, useRef } from 'react';
import ARControls from '@/components/ARControls';
import { ARScene, PlaceholderScene } from '@/components/ARScene';
import { WebLLMProvider, useWebLLM } from '@/contexts/WebLLMContext';
import { useVoice } from '@/hooks/useVoice';
import { useTaskState, DEFAULT_ASSEMBLY_TASK, type TaskStep } from '@/hooks/useTaskState';
import type { DetectedObject } from '@/schemas/vision';

function ARContent() {
  const [isARActive, setIsARActive] = useState(false);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const [voiceCommand, setVoiceCommand] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(true);
  const sceneImageRef = useRef<ImageBitmap | null>(null);
  
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
  } = useTaskState();

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
    } catch (error) {
      console.error('Failed to start AR:', error);
      alert('Failed to start AR session');
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

    if (taskState.isActive && objects.length > 0) {
      const currentStep = taskState.steps[taskState.currentStepIndex];
      const targetObject = currentStep?.targetObject;

      if (targetObject) {
        const foundTarget = objects.find(obj => 
          obj.name.toLowerCase().includes(targetObject.toLowerCase())
        );
        
        if (foundTarget) {
          completeCurrentStep();
        }
      }
    }

    const actions = objects
      .filter(obj => obj.action)
      .map(obj => `${obj.name}: ${obj.action}`)
      .join('. ');

    if (actions) {
      speak(actions);
    }
  }, [speak, taskState, completeCurrentStep]);

  const generatePlanFromGoal = useCallback(async (goal: string, _image: unknown): Promise<TaskStep[]> => {
    if (!sceneImageRef.current) {
      console.warn('[App] No scene image available for planning');
      return DEFAULT_ASSEMBLY_TASK;
    }
    
    try {
      const steps = await runPlanningInference(sceneImageRef.current, goal);
      if (steps && steps.length > 0) {
        return steps;
      }
    } catch (error) {
      console.error('[App] Planning inference failed:', error);
    }
    return DEFAULT_ASSEMBLY_TASK;
  }, [runPlanningInference]);

  const triggerPlanningMode = useCallback(async (userGoal: string) => {
    if (!isModelReady || isPlanning) return;
    
    await generateTaskPlan(userGoal, sceneImageRef.current!, generatePlanFromGoal);
  }, [isModelReady, isPlanning, generateTaskPlan, generatePlanFromGoal]);

  useEffect(() => {
    if (voiceCommand && isModelReady) {
      const isCleaningGoal = /clean|organize|trash|garbage|mess|fix|help/i.test(voiceCommand);
      
      if (isCleaningGoal && !taskState.isActive) {
        triggerPlanningMode(voiceCommand);
      } else {
        setTimeout(() => setVoiceCommand(null), 0);
      }
    }
  }, [voiceCommand, isModelReady, taskState.isActive, triggerPlanningMode]);

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
            <li>• Wi-Fi recommended (~2.3GB model download)</li>
            <li>• High battery usage expected during inference</li>
            <li>• 8GB+ RAM required for optimal performance</li>
          </ul>
          <button 
            onClick={() => setShowWarnings(false)}
            className="mt-3 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded"
          >
            Acknowledge
          </button>
        </div>
      )}

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
            taskActive={taskState.isActive}
            currentStepTarget={taskState.steps[taskState.currentStepIndex]?.targetObject}
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

      {isPlanning && (
        <div className="fixed top-32 left-1/2 -translate-x-1/2 z-50 
                        bg-purple-600/90 backdrop-blur-md text-white rounded-lg px-6 py-3 max-w-lg border-2 border-purple-400">
          <p className="text-sm font-semibold">Analyzing scene and generating task plan...</p>
        </div>
      )}

      {taskState.isActive && currentInstruction && !isPlanning && (
        <div className="fixed top-32 left-1/2 -translate-x-1/2 z-50 
                        bg-orange-600/90 backdrop-blur-md text-white rounded-lg px-6 py-3 max-w-lg border-2 border-orange-400">
          <p className="text-xs font-bold uppercase tracking-wider mb-1">Step {taskState.currentStepIndex + 1}/{taskState.steps.length}</p>
          <p className="text-sm font-semibold">{currentInstruction}</p>
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

      {isInferring && !isPlanning && (
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