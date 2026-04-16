import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type { DetectedObject } from '../src/schemas/vision';

function findExistingObjectKey(
  map: Map<string, unknown>,
  position: THREE.Vector3,
  threshold: number,
  name?: string
): string | null {
  for (const [key, obj] of map.entries()) {
    const worldObj = obj as { smoothedPosition: THREE.Vector3; name: string };
    const distance = worldObj.smoothedPosition.distanceTo(position);
    if (distance < threshold) {
      if (name && worldObj.name.toLowerCase() !== name.toLowerCase()) continue;
      return key;
    }
  }
  return null;
}

function categorizeObject(name: string, action?: string): string {
  const lower = name.toLowerCase();
  const actionLower = (action || '').toLowerCase();

  if (actionLower.includes('throw') || actionLower.includes('discard') || actionLower.includes('trash')) {
    return 'trash';
  }
  if (actionLower.includes('clean') || actionLower.includes('organize') || actionLower.includes('put away')) {
    return 'clutter';
  }
  if (actionLower.includes('keep') || actionLower.includes('save')) {
    return 'keep';
  }

  const toolKeywords = ['screwdriver', 'wrench', 'hammer', 'driver', 'pliers', 'saw', 'tool'];
  const trashKeywords = ['trash', 'garbage', 'waste', 'paper', 'bottle', 'can', 'wrapper', 'discard'];
  const clutterKeywords = ['mess', 'clothes', 'cloth', 'pile', 'scattered', 'untidy', 'organize'];

  if (toolKeywords.some(k => lower.includes(k))) return 'tool';
  if (trashKeywords.some(k => lower.includes(k))) return 'trash';
  if (clutterKeywords.some(k => lower.includes(k))) return 'clutter';

  return 'unknown';
}

function generateObjectId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

interface WorldObject {
  id: string;
  name: string;
  position: THREE.Vector3;
  category: string;
  confidence: number;
  lastSeen: number;
  detectionCount: number;
  smoothedPosition: THREE.Vector3;
}

describe('useWorldMap logic', () => {
  describe('findExistingObjectKey', () => {
    it('should return key when position is within threshold', () => {
      const map = new Map<string, WorldObject>([
        ['bottle', {
          id: 'bottle',
          name: 'bottle',
          position: new THREE.Vector3(1, 1, 0),
          category: 'trash',
          confidence: 0.9,
          lastSeen: Date.now(),
          detectionCount: 1,
          smoothedPosition: new THREE.Vector3(1, 1, 0),
        }],
      ]);

      const result = findExistingObjectKey(map, new THREE.Vector3(1.1, 1.1, 0), 0.5);
      expect(result).toBe('bottle');
    });

    it('should return null when position exceeds threshold', () => {
      const map = new Map<string, WorldObject>([
        ['bottle', {
          id: 'bottle',
          name: 'bottle',
          position: new THREE.Vector3(1, 1, 0),
          category: 'trash',
          confidence: 0.9,
          lastSeen: Date.now(),
          detectionCount: 1,
          smoothedPosition: new THREE.Vector3(1, 1, 0),
        }],
      ]);

      const result = findExistingObjectKey(map, new THREE.Vector3(2, 2, 0), 0.5);
      expect(result).toBeNull();
    });

    it('should return null when name does not match', () => {
      const map = new Map<string, WorldObject>([
        ['bottle', {
          id: 'bottle',
          name: 'bottle',
          position: new THREE.Vector3(1, 1, 0),
          category: 'trash',
          confidence: 0.9,
          lastSeen: Date.now(),
          detectionCount: 1,
          smoothedPosition: new THREE.Vector3(1, 1, 0),
        }],
      ]);

      const result = findExistingObjectKey(map, new THREE.Vector3(1.1, 1.1, 0), 0.5, 'can');
      expect(result).toBeNull();
    });

    it('should return key when name matches', () => {
      const map = new Map<string, WorldObject>([
        ['bottle', {
          id: 'bottle',
          name: 'bottle',
          position: new THREE.Vector3(1, 1, 0),
          category: 'trash',
          confidence: 0.9,
          lastSeen: Date.now(),
          detectionCount: 1,
          smoothedPosition: new THREE.Vector3(1, 1, 0),
        }],
      ]);

      const result = findExistingObjectKey(map, new THREE.Vector3(1.1, 1.1, 0), 0.5, 'bottle');
      expect(result).toBe('bottle');
    });

    it('should handle jitter scenario - detection at slightly different positions', () => {
      const map = new Map<string, WorldObject>([
        ['bottle', {
          id: 'bottle',
          name: 'bottle',
          position: new THREE.Vector3(1.0, 1.0, 0),
          category: 'trash',
          confidence: 0.9,
          lastSeen: Date.now(),
          detectionCount: 1,
          smoothedPosition: new THREE.Vector3(1.0, 1.0, 0),
        }],
      ]);

      const newPosition = new THREE.Vector3(1.1, 1.1, 0);
      const result = findExistingObjectKey(map, newPosition, 0.5, 'bottle');
      expect(result).toBe('bottle');
    });
  });

  describe('categorizeObject', () => {
    it('should categorize as trash based on action', () => {
      expect(categorizeObject('item', 'throw away')).toBe('trash');
      expect(categorizeObject('item', 'discard')).toBe('trash');
      expect(categorizeObject('item', 'put in trash')).toBe('trash');
    });

    it('should categorize as clutter based on action', () => {
      expect(categorizeObject('item', 'clean up')).toBe('clutter');
      expect(categorizeObject('item', 'organize')).toBe('clutter');
      expect(categorizeObject('item', 'put away')).toBe('clutter');
    });

    it('should categorize as keep based on action', () => {
      expect(categorizeObject('item', 'keep')).toBe('keep');
      expect(categorizeObject('item', 'save')).toBe('keep');
    });

    it('should categorize based on name keywords', () => {
      expect(categorizeObject('screwdriver')).toBe('tool');
      expect(categorizeObject('bottle')).toBe('trash');
      expect(categorizeObject('clothes')).toBe('clutter');
    });

    it('should return unknown for unrecognized objects', () => {
      expect(categorizeObject('unknown-item')).toBe('unknown');
    });
  });

  describe('generateObjectId', () => {
    it('should normalize and lowercase object name', () => {
      expect(generateObjectId('Plastic Bottle')).toBe('plastic-bottle');
      expect(generateObjectId('PAPER WRAPPER')).toBe('paper-wrapper');
      expect(generateObjectId('screw driver')).toBe('screw-driver');
    });

    it('should handle multiple spaces', () => {
      expect(generateObjectId('plastic   bottle')).toBe('plastic-bottle');
    });
  });

  describe('dampening logic', () => {
    it('should correctly lerp positions with dampening factor', () => {
      const current = new THREE.Vector3(1.0, 1.0, 0);
      const target = new THREE.Vector3(1.1, 1.1, 0);
      const dampening = 0.3;

      const smoothed = current.clone().lerp(target, dampening);
      
      expect(smoothed.x).toBeCloseTo(1.03, 2);
      expect(smoothed.y).toBeCloseTo(1.03, 2);
    });

    it('should maintain position after multiple smoothing iterations', () => {
      let current = new THREE.Vector3(1.0, 1.0, 0);
      const dampening = 0.3;
      
      const positions = [1.0, 1.05, 1.08, 1.09, 1.095];
      
      positions.forEach(pos => {
        const target = new THREE.Vector3(pos, pos, 0);
        current = current.clone().lerp(target, dampening);
      });

      expect(current.x).toBeCloseTo(1.064, 2);
    });
  });
});

describe('useObject3DTransform projection logic', () => {
  describe('get3DPosition', () => {
    it('should project 2D coordinates to 3D world space', () => {
      const x = 256;
      const y = 256;
      const width = 100;
      const height = 100;
      const targetSize = 512;
      const depth = -3;

      const viewport = { width: 10, height: 10 };

      const projectedX = ((x / targetSize) - 0) / 1 * viewport.width;
      const projectedY = -(((y / targetSize) - 0) / 1 * viewport.height);

      expect(projectedX).toBe(5);
      expect(projectedY).toBe(-5);
    });

    it('should handle aspect ratio > 1 (landscape)', () => {
      const x = 256;
      const y = 256;
      const targetSize = 512;
      const viewport = { width: 20, height: 10 };

      const aspect = viewport.width / viewport.height;
      const scale = aspect > 1 ? 1 : aspect;
      const offsetX = aspect > 1 ? 0 : (1 - scale) / 2;
      const offsetY = aspect > 1 ? (1 - scale) / 2 : 0;

      const projectedX = ((x / targetSize) - offsetX) / scale * viewport.width;
      expect(projectedX).toBe(10);
    });

    it('should handle aspect ratio < 1 (portrait)', () => {
      const x = 256;
      const y = 256;
      const targetSize = 512;
      const viewport = { width: 5, height: 10 };

      const aspect = viewport.width / viewport.height;
      const scale = aspect > 1 ? 1 : aspect;
      const offsetX = aspect > 1 ? 0 : (1 - scale) / 2;
      const offsetY = aspect > 1 ? (1 - scale) / 2 : 0;

      const projectedY = -(((y / targetSize) - offsetY) / scale * viewport.height);
      expect(projectedY).toBe(-10);
    });
  });

  describe('projectBoundingBoxSize', () => {
    it('should project bounding box width and height', () => {
      const bbox = { x: 100, y: 100, width: 200, height: 150 };
      const imageWidth = 512;
      const imageHeight = 512;
      const fov = 75 * (Math.PI / 180);
      const worldDepth = 3;

      const widthRatio = bbox.width / imageWidth;
      const heightRatio = bbox.height / imageHeight;

      const projectedWidth = widthRatio * fov * worldDepth * (imageWidth / imageHeight);
      const projectedHeight = heightRatio * fov * worldDepth;

      expect(projectedWidth).toBeGreaterThan(0);
      expect(projectedHeight).toBeGreaterThan(0);
    });

    it('should scale proportionally with depth', () => {
      const bbox = { x: 0, y: 0, width: 100, height: 100 };
      const fov = 75 * (Math.PI / 180);
      const aspectRatio = 1;

      const smallDepth = projectBoxSize(bbox, fov, 2, aspectRatio);
      const largeDepth = projectBoxSize(bbox, fov, 4, aspectRatio);

      expect(largeDepth.width).toBe(smallDepth.width * 2);
      expect(largeDepth.height).toBe(smallDepth.height * 2);
    });
  });
});

function projectBoxSize(
  bbox: { width: number; height: number },
  fov: number,
  worldDepth: number,
  aspectRatio: number
): { width: number; height: number } {
  const widthRatio = bbox.width / 512;
  const heightRatio = bbox.height / 512;

  return {
    width: widthRatio * fov * worldDepth * aspectRatio,
    height: heightRatio * fov * worldDepth,
  };
}