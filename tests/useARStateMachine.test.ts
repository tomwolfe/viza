import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useARStateMachine, type ARState } from '@/hooks/useARStateMachine';

describe('useARStateMachine', () => {
  it('should start in idle state', () => {
    const { result } = renderHook(() => useARStateMachine());
    expect(result.current.state.type).toBe('idle');
  });

  it('should transition from idle to initializing on INIT_MODEL', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    expect(result.current.state.type).toBe('initializing');
  });

  it('should transition from initializing to ready on MODEL_READY', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatch({ type: 'MODEL_READY', progress: 100 });
    });

    const state = result.current.state as ARState;
    if (state.type === 'ready') {
      expect(state.modelProgress).toBe(100);
    } else {
      throw new Error('Expected state to be ready');
    }
  });

  it('should track MODEL_PROGRESS updates', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatch({ type: 'MODEL_PROGRESS', progress: 50 });
    });

    const state = result.current.state as ARState;
    if (state.type === 'ready') {
      expect(state.modelProgress).toBe(50);
    } else {
      throw new Error('Expected state to be ready');
    }
  });

  it('should transition from ready to running on START_INFERENCING', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatch({ type: 'MODEL_READY', progress: 100 });
    });

    act(() => {
      result.current.dispatchActions.startInferencing();
    });

    expect(result.current.state.type).toBe('running');
  });

  it('should transition from running back to ready on STOP_INFERENCING', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatch({ type: 'MODEL_READY', progress: 100 });
    });

    act(() => {
      result.current.dispatchActions.startInferencing();
    });

    act(() => {
      result.current.dispatchActions.stopInferencing();
    });

    expect(result.current.state.type).toBe('ready');
  });

  it('should transition from ready to planning on START_PLANNING', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatch({ type: 'MODEL_READY', progress: 100 });
    });

    act(() => {
      result.current.dispatchActions.startPlanning();
    });

    expect(result.current.state.type).toBe('planning');
  });

  it('should transition from planning back to ready on STOP_PLANNING', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatch({ type: 'MODEL_READY', progress: 100 });
    });

    act(() => {
      result.current.dispatchActions.startPlanning();
    });

    act(() => {
      result.current.dispatchActions.stopPlanning();
    });

    expect(result.current.state.type).toBe('ready');
  });

  it('should transition to error state on ERROR action', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatchActions.handleError('Model failed', 'MODEL_NOT_READY');
    });

    const state = result.current.state as ARState;
    if (state.type === 'error') {
      expect(state.error).toBe('Model failed');
      expect(state.errorCode).toBe('MODEL_NOT_READY');
    } else {
      throw new Error('Expected state to be error');
    }
  });

  it('should not allow START_INFERENCING from idle state', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatch({ type: 'START_INFERENCING' });
    });

    expect(result.current.state.type).toBe('idle');
  });

  it('should allow reset from error state', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatchActions.handleError('Error occurred', null);
    });

    act(() => {
      result.current.dispatchActions.reset();
    });

    expect(result.current.state.type).toBe('idle');
  });

  it('should handle COMPLETE_STEP returning to ready', () => {
    const { result } = renderHook(() => useARStateMachine());

    act(() => {
      result.current.dispatchActions.initModel();
    });

    act(() => {
      result.current.dispatch({ type: 'MODEL_READY', progress: 100 });
    });

    act(() => {
      result.current.dispatchActions.startInferencing();
    });

    act(() => {
      result.current.dispatch({ type: 'COMPLETE_STEP' });
    });

    expect(result.current.state.type).toBe('ready');
  });
});
