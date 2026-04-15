import { describe, it, expect } from 'vitest';
import {
  calculateDistance2D,
  calculateDistance3D,
  isWithinThreshold,
} from '../src/utils/spatial';

describe('spatial.ts', () => {
  describe('calculateDistance2D', () => {
    it('should calculate Euclidean distance between two 2D points', () => {
      const pos1 = { x: 0, y: 0 };
      const pos2 = { x: 3, y: 4 };

      const result = calculateDistance2D(pos1, pos2);

      expect(result).toBe(5);
    });

    it('should return 0 for same position', () => {
      const pos1 = { x: 5, y: 5 };
      const pos2 = { x: 5, y: 5 };

      const result = calculateDistance2D(pos1, pos2);

      expect(result).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const pos1 = { x: -3, y: -4 };
      const pos2 = { x: 0, y: 0 };

      const result = calculateDistance2D(pos1, pos2);

      expect(result).toBe(5);
    });

    it('should handle horizontal distance', () => {
      const pos1 = { x: 0, y: 0 };
      const pos2 = { x: 10, y: 0 };

      const result = calculateDistance2D(pos1, pos2);

      expect(result).toBe(10);
    });

    it('should handle vertical distance', () => {
      const pos1 = { x: 0, y: 0 };
      const pos2 = { x: 0, y: 10 };

      const result = calculateDistance2D(pos1, pos2);

      expect(result).toBe(10);
    });
  });

  describe('calculateDistance3D', () => {
    it('should calculate Euclidean distance between two 3D points', () => {
      const pos1 = { x: 0, y: 0, z: 0 };
      const pos2 = { x: 1, y: 2, z: 2 };

      const result = calculateDistance3D(pos1, pos2);

      expect(result).toBeCloseTo(3);
    });

    it('should return 0 for same position', () => {
      const pos1 = { x: 1, y: 1, z: 1 };
      const pos2 = { x: 1, y: 1, z: 1 };

      const result = calculateDistance3D(pos1, pos2);

      expect(result).toBe(0);
    });

    it('should handle origin', () => {
      const pos1 = { x: 0, y: 0, z: 0 };
      const pos2 = { x: 3, y: 4, z: 0 };

      const result = calculateDistance3D(pos1, pos2);

      expect(result).toBe(5);
    });
  });

  describe('isWithinThreshold', () => {
    it('should return true when distance is below threshold', () => {
      const pos1 = { x: 0, y: 0, z: 0, distanceTo: () => 0.3, clone: () => pos1 };
      const pos2 = { x: 0.3, y: 0, z: 0 };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = isWithinThreshold(pos1 as any, pos2 as any, 0.5);

      expect(result).toBe(true);
    });

    it('should return false when distance exceeds threshold', () => {
      const pos1 = { x: 0, y: 0, z: 0, distanceTo: () => 1, clone: () => pos1 };
      const pos2 = { x: 1, y: 0, z: 0 };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = isWithinThreshold(pos1 as any, pos2 as any, 0.5);

      expect(result).toBe(false);
    });

    it('should return true when at exact threshold', () => {
      const pos1 = { x: 0, y: 0, z: 0, distanceTo: () => 0.499999, clone: () => pos1 };
      const pos2 = { x: 0.5, y: 0, z: 0 };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = isWithinThreshold(pos1 as any, pos2 as any, 0.5);

      expect(result).toBe(true);
    });
  });
});