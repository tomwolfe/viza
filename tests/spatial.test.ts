import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  calculateDistance,
  isWithinThreshold,
} from '../src/utils/spatial';

const createMockVector3 = (x: number, y: number, z: number, distanceToReturn?: number): THREE.Vector3 => {
  const mock = new THREE.Vector3(x, y, z);
  if (distanceToReturn !== undefined) {
    mock.distanceTo = vi.fn().mockReturnValue(distanceToReturn);
  }
  return mock;
};

describe('spatial.ts', () => {
  describe('calculateDistance', () => {
    it('should calculate Euclidean distance between two 2D points', () => {
      const pos1 = { x: 0, y: 0 };
      const pos2 = { x: 3, y: 4 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBe(5);
    });

    it('should return 0 for same position', () => {
      const pos1 = { x: 5, y: 5 };
      const pos2 = { x: 5, y: 5 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const pos1 = { x: -3, y: -4 };
      const pos2 = { x: 0, y: 0 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBe(5);
    });

    it('should handle horizontal distance', () => {
      const pos1 = { x: 0, y: 0 };
      const pos2 = { x: 10, y: 0 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBe(10);
    });

    it('should handle vertical distance', () => {
      const pos1 = { x: 0, y: 0 };
      const pos2 = { x: 0, y: 10 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBe(10);
    });

    it('should calculate Euclidean distance between two 3D points', () => {
      const pos1 = { x: 0, y: 0, z: 0 };
      const pos2 = { x: 1, y: 2, z: 2 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBeCloseTo(3);
    });

    it('should return 0 for same 3D position', () => {
      const pos1 = { x: 1, y: 1, z: 1 };
      const pos2 = { x: 1, y: 1, z: 1 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBe(0);
    });

    it('should handle origin in 3D', () => {
      const pos1 = { x: 0, y: 0, z: 0 };
      const pos2 = { x: 3, y: 4, z: 0 };

      const result = calculateDistance(pos1, pos2);

      expect(result).toBe(5);
    });
  });

  describe('isWithinThreshold', () => {
    it('should return true when distance is below threshold', () => {
      const pos1 = createMockVector3(0, 0, 0, 0.3);
      const pos2 = createMockVector3(0.3, 0, 0);

      const result = isWithinThreshold(pos1, pos2, 0.5);

      expect(result).toBe(true);
    });

    it('should return false when distance exceeds threshold', () => {
      const pos1 = createMockVector3(0, 0, 0, 1);
      const pos2 = createMockVector3(1, 0, 0);

      const result = isWithinThreshold(pos1, pos2, 0.5);

      expect(result).toBe(false);
    });

    it('should return true when at exact threshold', () => {
      const pos1 = createMockVector3(0, 0, 0, 0.499999);
      const pos2 = createMockVector3(0.5, 0, 0);

      const result = isWithinThreshold(pos1, pos2, 0.5);

      expect(result).toBe(true);
    });
  });
});