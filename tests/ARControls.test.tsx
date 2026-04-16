import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Play, Mic, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';

vi.mock('lucide-react', () => ({
  Play: () => <svg data-testid="play-icon" />,
  Mic: () => <svg data-testid="mic-icon" />,
  Loader2: () => <svg data-testid="loader-icon" />,
  AlertTriangle: () => <svg data-testid="alert-icon" />,
  RotateCcw: () => <svg data-testid="reset-icon" />,
}));

import ARControls from '../src/components/ARControls';

describe('ARControls', () => {
  const defaultProps = {
    onStartAR: vi.fn(),
    onVoiceInput: vi.fn(),
    isARActive: false,
    isModelLoading: false,
    modelProgress: 0,
    isListening: false,
  };

  it('should render Ready to Start when not active and not loading', () => {
    render(<ARControls {...defaultProps} />);
    expect(screen.getByText('Ready to Start')).toBeInTheDocument();
  });

  it('should render loading progress when model is loading', () => {
    render(<ARControls {...defaultProps} isModelLoading={true} modelProgress={50} />);
    expect(screen.getByText(/Loading AI model/)).toBeInTheDocument();
  });

  it('should show AR Active when active', () => {
    render(<ARControls {...defaultProps} isARActive={true} />);
    expect(screen.getByText('AR Active')).toBeInTheDocument();
  });

  it('should show device incompatibility message', () => {
    render(<ARControls {...defaultProps} isDeviceIncompatible={true} />);
    expect(screen.getByText('Device not compatible. WebGPU required.')).toBeInTheDocument();
  });

  it('should show error message when errorCode is provided', () => {
    const props = {
      ...defaultProps,
      errorCode: 'CAMERA_NOT_ALLOWED' as const,
      error: 'Permission denied',
    };
    render(<ARControls {...props} />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText(/Please allow camera/)).toBeInTheDocument();
  });

  it('should disable Start AR button when model is loading', () => {
    render(<ARControls {...defaultProps} isModelLoading={true} />);
    const button = screen.getByRole('button', { name: /start ar session/i });
    expect(button).toBeDisabled();
  });

  it('should show Start AR button when not active', () => {
    render(<ARControls {...defaultProps} />);
    expect(screen.getByRole('button', { name: /start ar session/i })).toBeInTheDocument();
  });

  it('should show voice input button when AR is active', () => {
    render(<ARControls {...defaultProps} isARActive={true} />);
    expect(screen.getByRole('button', { name: /activate voice input/i })).toBeInTheDocument();
  });

  it('should show reset camera button when onResetCamera is provided and AR is active', () => {
    render(<ARControls {...defaultProps} isARActive={true} onResetCamera={vi.fn()} />);
    expect(screen.getByRole('button', { name: /reset camera/i })).toBeInTheDocument();
  });

  it('should show Listening state when voice input is active', () => {
    render(<ARControls {...defaultProps} isARActive={true} isListening={true} />);
    expect(screen.getByText('Listening...')).toBeInTheDocument();
  });
});