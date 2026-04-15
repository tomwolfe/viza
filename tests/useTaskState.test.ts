import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskState, TaskStep, DEFAULT_ASSEMBLY_TASK } from '../src/hooks/useTaskState';

vi.mock('../src/utils/safeStorage', () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
  SCHEMA_VERSION: '1.0.0',
}));

describe('useTaskState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useTaskState());

    expect(result.current.taskState.taskId).toBeNull();
    expect(result.current.taskState.taskName).toBe('');
    expect(result.current.taskState.currentStepIndex).toBe(0);
    expect(result.current.taskState.steps).toEqual([]);
    expect(result.current.taskState.isActive).toBe(false);
    expect(result.current.taskState.completed).toBe(false);
    expect(result.current.isPlanning).toBe(false);
  });

  it('should start a task with provided steps', () => {
    const { result } = renderHook(() => useTaskState());
    const testSteps: TaskStep[] = [
      { id: 'step-1', instruction: 'Pick up object', validationPrompt: 'Is object in hand?' },
      { id: 'step-2', instruction: 'Place object', validationPrompt: 'Is object placed?' },
    ];

    act(() => {
      result.current.startTask('Test Task', testSteps);
    });

    expect(result.current.taskState.taskName).toBe('Test Task');
    expect(result.current.taskState.steps).toEqual(testSteps);
    expect(result.current.taskState.isActive).toBe(true);
    expect(result.current.taskState.currentStepIndex).toBe(0);
  });

  it('should advance to next step', () => {
    const { result } = renderHook(() => useTaskState());
    const testSteps: TaskStep[] = [
      { id: 'step-1', instruction: 'Step 1', validationPrompt: 'Step 1 done?' },
      { id: 'step-2', instruction: 'Step 2', validationPrompt: 'Step 2 done?' },
    ];

    act(() => {
      result.current.startTask('Test Task', testSteps);
    });

    act(() => {
      result.current.nextStep();
    });

    expect(result.current.taskState.currentStepIndex).toBe(1);
  });

  it('should mark task as completed when reaching last step', () => {
    const { result } = renderHook(() => useTaskState());
    const testSteps: TaskStep[] = [
      { id: 'step-1', instruction: 'Step 1', validationPrompt: 'Done?' },
    ];

    act(() => {
      result.current.startTask('Test Task', testSteps);
    });

    act(() => {
      result.current.nextStep();
    });

    expect(result.current.taskState.completed).toBe(true);
    expect(result.current.taskState.isActive).toBe(false);
  });

  it('should go to previous step', () => {
    const { result } = renderHook(() => useTaskState());
    const testSteps: TaskStep[] = [
      { id: 'step-1', instruction: 'Step 1', validationPrompt: 'Done?' },
      { id: 'step-2', instruction: 'Step 2', validationPrompt: 'Done?' },
    ];

    act(() => {
      result.current.startTask('Test Task', testSteps);
    });

    act(() => {
      result.current.nextStep();
    });

    act(() => {
      result.current.previousStep();
    });

    expect(result.current.taskState.currentStepIndex).toBe(0);
  });

  it('should not go before first step', () => {
    const { result } = renderHook(() => useTaskState());
    const testSteps: TaskStep[] = [
      { id: 'step-1', instruction: 'Step 1', validationPrompt: 'Done?' },
    ];

    act(() => {
      result.current.startTask('Test Task', testSteps);
    });

    act(() => {
      result.current.previousStep();
    });

    expect(result.current.taskState.currentStepIndex).toBe(0);
  });

  it('should reset task state', () => {
    const { result } = renderHook(() => useTaskState());
    const testSteps: TaskStep[] = [
      { id: 'step-1', instruction: 'Step 1', validationPrompt: 'Done?' },
    ];

    act(() => {
      result.current.startTask('Test Task', testSteps);
    });

    act(() => {
      result.current.resetTask();
    });

    expect(result.current.taskState.taskId).toBeNull();
    expect(result.current.taskState.taskName).toBe('');
    expect(result.current.taskState.currentStepIndex).toBe(0);
    expect(result.current.taskState.steps).toEqual([]);
    expect(result.current.taskState.isActive).toBe(false);
    expect(result.current.taskState.completed).toBe(false);
  });

  it('should return current step', () => {
    const { result } = renderHook(() => useTaskState());
    const testSteps: TaskStep[] = [
      { id: 'step-1', instruction: 'Step 1', validationPrompt: 'Done?' },
      { id: 'step-2', instruction: 'Step 2', validationPrompt: 'Done?' },
    ];

    act(() => {
      result.current.startTask('Test Task', testSteps);
    });

    const currentStep = result.current.getCurrentStep();

    expect(currentStep?.id).toBe('step-1');
    expect(currentStep?.instruction).toBe('Step 1');
  });

  it('should return null when no active task', () => {
    const { result } = renderHook(() => useTaskState());

    const currentStep = result.current.getCurrentStep();

    expect(currentStep).toBeNull();
  });

  it('should track planning state', () => {
    const { result } = renderHook(() => useTaskState());

    expect(result.current.isPlanning).toBe(false);
  });
});