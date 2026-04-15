'use client';

import { create } from 'zustand';

interface ARStore {
  voiceTranscript: string | null;
  triggerInference: (transcript: string) => void;
  setVoiceTranscript: (transcript: string | null) => void;
}

export const useARStore = create<ARStore>((set) => ({
  voiceTranscript: null,
  triggerInference: (transcript: string) => {
    set({ voiceTranscript: transcript });
  },
  setVoiceTranscript: (transcript: string | null) => {
    set({ voiceTranscript: transcript });
  },
}));