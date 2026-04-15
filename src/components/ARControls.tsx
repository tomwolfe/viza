'use client';

import { Play, Mic, Loader2 } from 'lucide-react';

interface ARControlsProps {
  onStartAR: () => void;
  onVoiceInput: () => void;
  isARActive: boolean;
  isModelLoading: boolean;
  modelProgress: number;
  isListening: boolean;
}

export default function ARControls({
  onStartAR,
  onVoiceInput,
  isARActive,
  isModelLoading,
  modelProgress,
  isListening,
}: ARControlsProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4 pointer-events-none">
      <div className="flex flex-col items-center gap-4">
        {/* Status Indicator */}
        <div className="bg-black/60 backdrop-blur-md rounded-xl px-6 py-3 text-white">
          {isModelLoading ? (
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Loading AI Model... {modelProgress}%</span>
            </div>
          ) : isARActive ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span>AR Active</span>
            </div>
          ) : (
            <span>Ready to Start</span>
          )}
        </div>

        {/* Control Buttons */}
        <div className="flex gap-4 pointer-events-auto">
          {!isARActive && (
            <button
              onClick={onStartAR}
              disabled={isModelLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 
                         text-white rounded-full p-4 shadow-lg transition-all
                         flex items-center gap-2"
            >
              <Play className="w-6 h-6" />
              <span>Start AR</span>
            </button>
          )}

          {isARActive && (
            <button
              onClick={onVoiceInput}
              disabled={isListening || isModelLoading}
              className={`
                ${isListening ? 'bg-red-600 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'}
                disabled:bg-gray-600 text-white rounded-full p-4 
                shadow-lg transition-all flex items-center gap-2
              `}
            >
              <Mic className="w-6 h-6" />
              <span>{isListening ? 'Listening...' : 'Ask'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
