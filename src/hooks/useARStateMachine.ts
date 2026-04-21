import { useReducer, useCallback, useRef, useEffect } from 'react';
import { logger } from '@/config';

export type ARState = 
  | { type: 'idle' }
  | { type: 'initializing'; progress: number }
  | { type: 'ready'; modelProgress?: number }
  | { type: 'running' }
  | { type: 'planning' }
  | { type: 'error'; error: string; errorCode: string | null };

export type ARAction =
  | { type: 'INIT_MODEL' }
  | { type: 'MODEL_READY'; progress?: number }
  | { type: 'MODEL_PROGRESS'; progress: number }
  | { type: 'START_INFERENCING' }
  | { type: 'STOP_INFERENCING' }
  | { type: 'START_PLANNING' }
  | { type: 'STOP_PLANNING' }
  | { type: 'COMPLETE_STEP' }
  | { type: 'ERROR'; error: string; errorCode: string | null }
  | { type: 'RESET' };

const initialState: ARState = { type: 'idle' };

function arReducer(state: ARState, action: ARAction): ARState {
  switch (state.type) {
    case 'idle':
      switch (action.type) {
        case 'INIT_MODEL':
          return { type: 'initializing', progress: 0 };
        case 'ERROR':
          return { type: 'error', error: action.error, errorCode: action.errorCode };
      }
      break;

    case 'initializing':
      switch (action.type) {
        case 'MODEL_PROGRESS':
          return { type: 'initializing', progress: action.progress };
        case 'MODEL_READY':
          return { type: 'ready', modelProgress: action.progress ?? 100 };
        case 'ERROR':
          return { type: 'error', error: action.error, errorCode: action.errorCode };
      }
      break;

    case 'ready':
      switch (action.type) {
        case 'MODEL_PROGRESS':
          return { type: 'ready', modelProgress: action.progress };
        case 'MODEL_READY':
          return { type: 'ready', modelProgress: action.progress ?? 100 };
        case 'START_INFERENCING':
          return { type: 'running' };
        case 'START_PLANNING':
          return { type: 'planning' };
        case 'ERROR':
          return { type: 'error', error: action.error, errorCode: action.errorCode };
      }
      break;

    case 'running':
      switch (action.type) {
        case 'STOP_INFERENCING':
          return { type: 'ready' };
        case 'COMPLETE_STEP':
          return { type: 'ready' };
        case 'ERROR':
          return { type: 'error', error: action.error, errorCode: action.errorCode };
      }
      break;

    case 'planning':
      switch (action.type) {
        case 'STOP_PLANNING':
          return { type: 'ready' };
        case 'ERROR':
          return { type: 'error', error: action.error, errorCode: action.errorCode };
      }
      break;

    case 'error':
      switch (action.type) {
        case 'RESET':
          return { type: 'idle' };
      }
      break;
  }

  return state;
}

export interface UseARStateMachineReturn {
  state: ARState;
  dispatch: React.Dispatch<ARAction>;
  dispatchActions: {
    initModel: () => void;
    startInferencing: () => void;
    stopInferencing: () => void;
    startPlanning: () => void;
    stopPlanning: () => void;
    completeStep: () => void;
    handleError: (error: string, errorCode: string | null) => void;
    reset: () => void;
  };
}

export function useARStateMachine(): UseARStateMachineReturn {
  const [state, dispatch] = useReducer(arReducer, initialState);
  const dispatchLogRef = useRef(false);

  useEffect(() => {
    if (!dispatchLogRef.current) {
      logger.debug('[ARStateMachine] State changed:', state.type);
      dispatchLogRef.current = true;
    }
  }, [state]);

  const dispatchActions = {
    initModel: useCallback(() => {
      dispatch({ type: 'INIT_MODEL' });
    }, []),

    startInferencing: useCallback(() => {
      dispatch({ type: 'START_INFERENCING' });
    }, []),

    stopInferencing: useCallback(() => {
      dispatch({ type: 'STOP_INFERENCING' });
    }, []),

    startPlanning: useCallback(() => {
      dispatch({ type: 'START_PLANNING' });
    }, []),

    stopPlanning: useCallback(() => {
      dispatch({ type: 'STOP_PLANNING' });
    }, []),

    handleError: useCallback((error: string, errorCode: string | null) => {
      dispatch({ type: 'ERROR', error, errorCode });
    }, []),

    completeStep: useCallback(() => {
      dispatch({ type: 'COMPLETE_STEP' });
    }, []),

    reset: useCallback(() => {
      dispatch({ type: 'RESET' });
    }, []),
  };

  return { state, dispatch, dispatchActions };
}
