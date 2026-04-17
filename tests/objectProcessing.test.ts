import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { categorizeObject, generateObjectId, getCategoryColor, getCategoryLabel, ObjectCategory } from '../src/utils/objectProcessing';
import { CONFIG } from '@/config';

// Mock CONFIG to ensure test isolation
vi.mock('@/config', () => ({
  CONFIG: {
    CATEGORIES: {
      TOOL: { keywords: ['hammer', 'wrench', 'drill'] },
      TRASH: { keywords: ['trash', 'junk', 'rubbish'] },
      CLUTTER: { keywords: ['book', 'paper', 'clothes'] },
    }
  }
}));

describe('Object Processing Utilities', () => {
  it('should categorize an object as trash if action includes "trash"', () => {
    expect(categorizeObject('old shoe', 'throw trash')).toBe('trash');
  });

  it('should categorize an object as clutter if action includes "clean"', () => {
    expect(categorizeObject('paper stack', 'clean')).toBe('clutter');
  });

  it('should categorize an object as keep if action includes "keep"', () => {
    expect(categorizeObject('photo', 'keep')).toBe('keep');
  });

  it('should categorize an object as tool if its name contains a tool keyword', () => {
    expect(categorizeObject('hammer')).toBe('tool');
  });

  it('should categorize an object as trash if its name contains a trash keyword', () => {
    expect(categorizeObject('junk pile')).toBe('trash');
  });

  it('should categorize an object as clutter if its name contains a clutter keyword', () => {
    expect(categorizeObject('book')).toBe('clutter');
  });

  it('should categorize unknown objects as unknown', () => {
    expect(categorizeObject('random object')).toBe('unknown');
  });

  it('should generate a consistent object ID based on name and position', () => {
    const position = new THREE.Vector3(1, 2, 3);
    expect(generateObjectId('My Hammer', position)).toBe('my-hammer');
  });

  it('should return the correct color for a "trash" category', () => {
    expect(getCategoryColor('trash')).toBe('#ff4444');
  });

  it('should return the correct label for a "keep" category', () => {
    expect(getCategoryLabel('keep')).toBe('Keep');
  });
});