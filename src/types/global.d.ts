/**
 * Global type declarations for cross-component window methods.
 */

declare global {
  interface Window {
    /**
     * Trigger AR scene inference with a voice transcript.
     * Set by ARScene component on mount.
     */
    __arSceneTriggerInference?: (transcript: string) => void;
  }
}

export {};
