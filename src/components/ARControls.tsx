'use client';

import { Play, Mic, Loader2, AlertTriangle, RotateCcw, RefreshCcw } from 'lucide-react';
import { useId } from 'react';
import { useVizaError } from '@/contexts/VizaErrorContext';


interface ARControlsProps {
  onStartAR: () => void;
  onVoiceInput: () => void;
  onResetCamera?: () => void;
  isARActive: boolean;
  isModelLoading: boolean;
  modelProgress: number;
  isListening: boolean;
  isDeviceIncompatible?: boolean;
}

export default function ARControls({
  onStartAR,
  onVoiceInput,
  onResetCamera,
  isARActive,
  isModelLoading,
  modelProgress,
  isListening,
  isDeviceIncompatible,
}: ARControlsProps) {
  const statusId = useId();
  const { unifiedError, unifiedErrorCode } = useVizaError();

  const renderStatusContent = () => {
    if (isDeviceIncompatible) {
      return (
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          <span>Device Incompatible</span>
        </div>
      );
    }

    if (unifiedError && unifiedErrorCode) {
      return (
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            <span>Error</span>
          </div>
          <span className="text-xs text-red-300">{unifiedError}</span>
          {unifiedErrorCode === 'MODEL_INIT_FAILED' && (
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs mt-1 flex items-center gap-1"
            >
              <RefreshCcw className="w-3 h-3" />
              Reset AI Engine
            </button>
          )}
        </div>
      );
    }

    if (isModelLoading) {
      return (
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>Loading AI Model (~2.3GB)... {modelProgress}%</span>
        </div>
      );
    }

    if (isARActive) {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" aria-hidden="true" />
          <span>AR Active</span>
        </div>
      );
    }

    return <span>Ready to Start</span>;
  };

  const getStatusText = () => {
    if (isDeviceIncompatible) return 'Device not compatible. WebGPU required.';
    if (isModelLoading) return `Loading AI model. ${modelProgress}% complete.`;
    if (isARActive) return 'AR session active. Tap microphone to issue voice command.';
    return 'Ready to start AR session.';
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4 pointer-events-none">
      <div className="flex flex-col items-center gap-4">
        <div
          id={statusId}
          className="bg-black/60 backdrop-blur-md rounded-xl px-6 py-3 text-white"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {renderStatusContent()}
        </div>

        <div className="flex gap-4 pointer-events-auto">
          {!isARActive && !isDeviceIncompatible && (
            <button
              onClick={onStartAR}
              disabled={isModelLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 
                         text-white rounded-full p-4 shadow-lg transition-all
                         flex items-center gap-2"
              aria-label="Start AR session"
            >
              <Play className="w-6 h-6" aria-hidden="true" />
              <span>Start AR</span>
            </button>
          )}

          {isARActive && (
            <>
              {onResetCamera && (
                <button
                  onClick={onResetCamera}
                  className="bg-gray-600 hover:bg-gray-700 text-white rounded-full p-4 
                           shadow-lg transition-all flex items-center gap-2"
                  aria-label="Reset camera"
                >
                  <RotateCcw className="w-6 h-6" aria-hidden="true" />
                </button>
              )}
              <button
                onClick={onVoiceInput}
                disabled={isListening || isModelLoading}
                className={`
                  ${isListening ? 'bg-red-600 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'}
                  disabled:bg-gray-600 text-white rounded-full p-4 
                  shadow-lg transition-all flex items-center gap-2
                `}
                aria-label={isListening ? 'Listening for voice command' : 'Activate voice input'}
                aria-pressed={isListening}
              >
                <Mic className="w-6 h-6" aria-hidden="true" />
                <span>{isListening ? 'Listening...' : 'Ask'}</span>
              </button>
            </>
          )}
        </div>

        <span className="sr-only" aria-live="assertive">
          {getStatusText()}
        </span>
      </div>
    </div>
  );
}
