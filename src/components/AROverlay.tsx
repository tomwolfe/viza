'use client';

import type { DetectedObject, TaskStep } from '@/schemas/vision';

interface AROverlayProps {
  transcript?: string | null;
  isPlanning: boolean;
  taskState: {
    isActive: boolean;
    currentStepIndex: number;
    steps: TaskStep[];
  };
  currentInstruction: string;
  detectedObjects: DetectedObject[];
  isSpeaking: boolean;
  isInferring: boolean;
  llmError?: string | null;
  voiceError?: string | null;
  appError?: string | null;
  isARActive: boolean;
}

interface StatusIndicatorProps {
  isPlanning: boolean;
  isInferring: boolean;
  isSpeaking: boolean;
}

function StatusIndicator({ isPlanning, isInferring, isSpeaking }: StatusIndicatorProps) {
  if (isPlanning) {
    return (
      <div className="fixed top-32 left-1/2 -translate-x-1/2 z-50 
                      bg-purple-600/90 backdrop-blur-md text-white rounded-lg px-6 py-3 max-w-lg border-2 border-purple-400">
        <p className="text-sm font-semibold">Analyzing scene and generating task plan...</p>
      </div>
    );
  }

  if (isInferring) {
    return (
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 
                      bg-blue-900/80 backdrop-blur-md text-white rounded-lg px-6 py-3">
        <p className="text-sm">Analyzing scene...</p>
      </div>
    );
  }

  if (isSpeaking) {
    return (
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 
                      bg-blue-900/80 backdrop-blur-md text-white rounded-lg px-6 py-3">
        <p className="text-sm">Speaking...</p>
      </div>
    );
  }

  return null;
}

interface InstructionPanelProps {
  taskState: {
    isActive: boolean;
    currentStepIndex: number;
    steps: TaskStep[];
  };
  currentInstruction: string;
}

function InstructionPanel({ taskState, currentInstruction }: InstructionPanelProps) {
  if (!taskState.isActive || !currentInstruction) return null;

  return (
    <div className="fixed top-32 left-1/2 -translate-x-1/2 z-50 
                    bg-orange-600/90 backdrop-blur-md text-white rounded-lg px-6 py-3 max-w-lg border-2 border-orange-400">
      <p className="text-xs font-bold uppercase tracking-wider mb-1">Step {taskState.currentStepIndex + 1}/{taskState.steps.length}</p>
      <p className="text-sm font-semibold">{currentInstruction}</p>
    </div>
  );
}

interface DetectionPanelProps {
  detectedObjects: DetectedObject[];
}

function DetectionPanel({ detectedObjects }: DetectionPanelProps) {
  if (detectedObjects.length === 0) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 
                    bg-green-900/80 backdrop-blur-md text-white rounded-lg px-4 py-2">
      <p className="text-xs">{detectedObjects.length} object(s) detected</p>
    </div>
  );
}

interface TranscriptDisplayProps {
  transcript: string;
}

function TranscriptDisplay({ transcript }: TranscriptDisplayProps) {
  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 
                    bg-white/10 backdrop-blur-md text-white rounded-lg px-6 py-3 max-w-md">
      <p className="text-sm italic">&lsquo;{transcript}&rsquo;</p>
    </div>
  );
}

interface ErrorToastProps {
  llmError?: string | null;
  voiceError?: string | null;
  appError?: string | null;
}

function ErrorToast({ llmError, voiceError, appError }: ErrorToastProps) {
  const error = appError || llmError || voiceError;
  if (!error) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 bg-red-900/80 backdrop-blur-md 
                    text-white rounded-lg p-4">
      <p className="text-sm font-semibold">Error</p>
      <p className="text-xs mt-1">{error}</p>
    </div>
  );
}

export default function AROverlay({
  transcript,
  isPlanning,
  taskState,
  currentInstruction,
  detectedObjects,
  isSpeaking,
  isInferring,
  llmError,
  voiceError,
  appError,
  isARActive,
}: AROverlayProps) {
  if (!isARActive) return null;

  return (
    <>
      {transcript && <TranscriptDisplay transcript={transcript} />}
      <StatusIndicator
        isPlanning={isPlanning}
        isInferring={isInferring}
        isSpeaking={isSpeaking}
      />
      <InstructionPanel
        taskState={taskState}
        currentInstruction={currentInstruction}
      />
      <DetectionPanel detectedObjects={detectedObjects} />
      <ErrorToast
        llmError={llmError}
        voiceError={voiceError}
        appError={appError}
      />
    </>
  );
}
