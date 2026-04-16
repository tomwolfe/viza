import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AROverlay from '../src/components/AROverlay';
import type { TaskStep } from '../src/schemas/vision';

describe('AROverlay', () => {
  const mockTaskStep: TaskStep = {
    id: 'step-1',
    instruction: 'Pick up the trash',
    targetObject: 'trash',
    validationPrompt: 'Is the trash picked up?',
  };

  const defaultProps = {
    transcript: null,
    isPlanning: false,
    taskState: {
      isActive: false,
      currentStepIndex: 0,
      steps: [mockTaskStep],
    },
    currentInstruction: '',
    detectedObjects: [],
    isSpeaking: false,
    isInferring: false,
    llmError: null,
    voiceError: null,
    appError: null,
    isARActive: false,
  };

  it('should return null when isARActive is false', () => {
    const { container } = render(<AROverlay {...defaultProps} isARActive={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render transcript when provided', () => {
    render(<AROverlay {...defaultProps} isARActive={true} transcript="Test transcript" />);
    expect(screen.getByText(/Test transcript/)).toBeInTheDocument();
  });

  it('should render planning message when isPlanning is true', () => {
    render(<AROverlay {...defaultProps} isARActive={true} isPlanning={true} />);
    expect(screen.getByText(/Analyzing scene and generating task plan/)).toBeInTheDocument();
  });

  it('should render task step when task is active', () => {
    const props = {
      ...defaultProps,
      isARActive: true,
      taskState: {
        isActive: true,
        currentStepIndex: 0,
        steps: [mockTaskStep],
      },
      currentInstruction: 'Pick up the trash',
    };
    render(<AROverlay {...props} />);
    expect(screen.getByText('Step 1/1')).toBeInTheDocument();
    expect(screen.getByText('Pick up the trash')).toBeInTheDocument();
  });

  it('should render detected objects count when objects are present', () => {
    const props = {
      ...defaultProps,
      isARActive: true,
      detectedObjects: [{ name: 'test', bbox_2d: [0, 0, 100, 100] as [number, number, number, number], action: 'keep', category: 'keep' }],
    };
    render(<AROverlay {...props} />);
    expect(screen.getByText('1 object(s) detected')).toBeInTheDocument();
  });

  it('should render speaking message when isSpeaking is true', () => {
    render(<AROverlay {...defaultProps} isARActive={true} isSpeaking={true} />);
    expect(screen.getByText('Speaking...')).toBeInTheDocument();
  });

  it('should render inferring message when isInferring is true', () => {
    render(<AROverlay {...defaultProps} isARActive={true} isInferring={true} />);
    expect(screen.getByText('Analyzing scene...')).toBeInTheDocument();
  });

  it('should render error message when appError is provided', () => {
    render(<AROverlay {...defaultProps} isARActive={true} appError="Test error" />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('should render error message when llmError is provided', () => {
    render(<AROverlay {...defaultProps} isARActive={true} llmError="LLM error" />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('LLM error')).toBeInTheDocument();
  });

  it('should render error message when voiceError is provided', () => {
    render(<AROverlay {...defaultProps} isARActive={true} voiceError="Voice error" />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Voice error')).toBeInTheDocument();
  });
});