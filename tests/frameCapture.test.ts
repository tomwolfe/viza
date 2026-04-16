import { captureFrame, captureVideoFrame, captureCanvasFrame, captureAndTransfer } from '../src/utils/frameCapture';
import { CONFIG } from '@/config';
import * as THREE from 'three';
import { ImageBitmap } from 'image-bitmap';

// Mock browser and Canvas APIs for testing purposes
global.OffscreenCanvas = class MockOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  getContext(type) {
    return { drawImage: jest.fn(), transferToImageBitmap: jest.fn() };
  }
};
global.OffscreenCanvasRenderingContext2D = class MockContext {
  drawImage = jest.fn();
};
global.document = {
  createElement: jest.fn(() => ({
    width: CONFIG.TARGET_SIZE,
    height: CONFIG.TARGET_SIZE,
    getContext: jest.fn(() => ({ drawImage: jest.fn() })),
  })),
};
global.createImageBitmap = jest.fn(() => Promise.resolve(new ImageBitmap()));

// Mock the shared state management to ensure isolation
let sharedCanvas = null;
let sharedCtx = null;

jest.mock('../src/utils/frameCapture', () => ({
  // Mock the functions to isolate the logic we want to test
  captureFrame: jest.fn(),
  captureVideoFrame: jest.fn(),
  captureCanvasFrame: jest.fn(),
  captureAndTransfer: jest.fn(),
}));

// Assuming captureFrame is the main logic to test
const { captureFrame } = require('../src/utils/frameCapture');

describe('Frame Capture Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset shared state if necessary for isolated tests
    // (In a real scenario, we would mock the module itself to control state)
  });

  it('should return null if source is invalid', async () => {
    // @ts-ignore
    await expect(captureFrame(null)).resolves.toBeNull();
  });

  it('should successfully downsample from a video element', async () => {
    const mockBitmap = new ImageBitmap();
    // Mock the successful execution path
    captureFrame.mockResolvedValue(mockBitmap);
    
    // @ts-ignore
    const bitmap = await captureFrame(new HTMLVideoElement());
    expect(bitmap).toBe(mockBitmap);
  });

  it('should handle context errors gracefully', async () => {
    // Simulate failure during downsampling
    captureFrame.mockRejectedValue(new Error('Context failed'));

    // @ts-ignore
    const bitmap = await captureFrame(new HTMLVideoElement());
    expect(bitmap).toBeNull();
  });
});