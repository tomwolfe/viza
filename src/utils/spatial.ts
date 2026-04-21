import * as THREE from 'three';
import { CONFIG } from '@/config';

export interface SpatialFilterOptions {
  minCutoff?: number;
  beta?: number;
  dCutoff?: number;
}

export function createSpatialFilter(
  initialValue: THREE.Vector3 = new THREE.Vector3(),
  options: SpatialFilterOptions = {}
): (value: THREE.Vector3, timestamp: number) => THREE.Vector3 {
  const { minCutoff = CONFIG.SPATIAL.ONE_EURO.MIN_CUTOFF, beta = CONFIG.SPATIAL.ONE_EURO.BETA, dCutoff = CONFIG.SPATIAL.ONE_EURO.DCUTOFF } = options;
  return createOneEuroFilter(initialValue, minCutoff, beta, dCutoff);
}

export interface BoundingBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HitTestResult {
  distance: number;
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
}

export function useGroundPlaneFallback(
  cameraPosition: THREE.Vector3,
  cameraDirection: THREE.Vector3
): THREE.Vector3 {
  const result = new THREE.Vector3();
  result.copy(cameraPosition);
  result.add(cameraDirection.multiplyScalar(-Math.abs(cameraPosition.y) / Math.abs(cameraDirection.y)));
  result.y = CONFIG.SPATIAL.GROUND_PLANE_Y;
  return result;
}

export interface SpatialEngineParams {
  x: number;
  y: number;
  width?: number;
  height?: number;
  targetSize: number;
  depth: number;
  fov: number;
  aspect: number;
  viewportWidth: number;
  viewportHeight: number;
  cameraPosition: THREE.Vector3;
  cameraQuaternion: THREE.Quaternion;
  hitTestResult?: HitTestResult;
}

export class SpatialEngine {
  static get3DPosition({
    x,
    y,
    targetSize,
    depth,
    aspect,
    viewportWidth,
    viewportHeight,
    cameraPosition,
    hitTestResult,
  }: Omit<SpatialEngineParams, 'width' | 'height' | 'fov' | 'cameraQuaternion'>): THREE.Vector3 {
    const result = new THREE.Vector3();

    if (hitTestResult) {
      result.copy(hitTestResult.position);
      result.x += (x / targetSize - 0.5) * CONFIG.SPATIAL.HIT_TEST_OFFSET;
      result.y += (y / targetSize - 0.5) * CONFIG.SPATIAL.HIT_TEST_OFFSET;
      return result;
    }

    const scale = aspect > 1 ? 1 : aspect;
    const offsetX = aspect > 1 ? 0 : (1 - scale) / 2;
    const offsetY = aspect > 1 ? (1 - scale) / 2 : 0;

    const relX = ((x / targetSize) - offsetX) / scale * viewportWidth;
    const relY = -(((y / targetSize) - offsetY) / scale * viewportHeight);

    const defaultZ = cameraPosition.z + depth;
    
    if (depth === CONFIG.SPATIAL.DEFAULT_DEPTH) {
      const cameraDirection = new THREE.Vector3(0, 0, -1);
      const cameraQuaternion = new THREE.Quaternion();
      cameraQuaternion.setFromEuler(new THREE.Euler(0, 0, 0));
      cameraDirection.applyQuaternion(cameraQuaternion);
      
      const t = Math.abs(cameraPosition.y - CONFIG.SPATIAL.GROUND_PLANE_Y) / Math.abs(cameraDirection.y || 1);
      const groundX = cameraPosition.x + cameraDirection.x * t;
      const groundY = CONFIG.SPATIAL.GROUND_PLANE_Y;
      const groundZ = cameraPosition.z + cameraDirection.z * t;
      
      return result.set(
        groundX + relX * 0.3,
        groundY,
        groundZ + relY * 0.3
      );
    }

    return result.set(
      cameraPosition.x + relX,
      cameraPosition.y + relY,
      defaultZ
    );
  }

  static projectBoundingBoxSize({
    width,
    height,
    targetSize,
    depth,
    fov,
    aspect,
  }: Pick<SpatialEngineParams, 'width' | 'height' | 'targetSize' | 'depth' | 'fov' | 'aspect'>): { width: number; height: number } {
    if (width === undefined || height === undefined) {
      return { width: 0, height: 0 };
    }

    const widthRatio = width / targetSize;
    const heightRatio = height / targetSize;

    const fovRad = (fov * Math.PI) / 180;
    const projectedWidth = widthRatio * fovRad * Math.abs(depth) * aspect;
    const projectedHeight = heightRatio * fovRad * Math.abs(depth);

    return {
      width: projectedWidth,
      height: projectedHeight,
    };
  }
}

// Keeping these as they are used elsewhere and weren't explicitly requested to be moved/changed
export function calculateDistance(
  pos1: { x: number; y: number },
  pos2: { x: number; y: number }
): number;
export function calculateDistance(
  pos1: { x: number; y: number; z: number },
  pos2: { x: number; y: number; z: number }
): number;
export function calculateDistance(
  pos1: { x: number; y: number; z?: number },
  pos2: { x: number; y: number; z?: number }
): number {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  const dz = (pos1.z ?? 0) - (pos2.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function isWithinThreshold(
  pos1: THREE.Vector3,
  pos2: THREE.Vector3,
  threshold: number
): boolean {
  return pos1.distanceTo(pos2) < threshold;
}

interface OneEuroFilterState {
  lastValue: THREE.Vector3;
  lastTime: number;
}

export function createOneEuroFilter(
  initialValue: THREE.Vector3 = new THREE.Vector3(),
  minCutoff: number = 0.5,
  beta: number = 0.7,
  dCutoff: number = 1.0
): (value: THREE.Vector3, timestamp: number) => THREE.Vector3 {
  const lastValue = initialValue.clone();
  const filteredResult = new THREE.Vector3();
  let dx = new THREE.Vector3();
  let dy = new THREE.Vector3();
  let dz = new THREE.Vector3();

  const state: OneEuroFilterState = {
    lastValue,
    lastTime: 0,
  };

  return (value: THREE.Vector3, timestamp: number) => {
    if (state.lastTime === 0) {
      lastValue.set(value.x, value.y, value.z);
      state.lastTime = timestamp;
      return filteredResult.set(value.x, value.y, value.z);
    }

    const dt = (timestamp - state.lastTime) / 1000;
    if (dt <= 0) {
      return filteredResult.set(lastValue.x, lastValue.y, lastValue.z);
    }

    dx.set((value.x - lastValue.x) / dt, 0, 0);
    dy.set(0, (value.y - lastValue.y) / dt, 0);
    dz.set(0, 0, (value.z - lastValue.z) / dt);

    const rate = Math.sqrt(dx.x * dx.x + dy.y * dy.y + dz.z * dz.z);
    const cutoff = minCutoff + beta * Math.max(0, rate - dCutoff);
    const alpha = Math.min(1, (cutoff * dt) / (1 + cutoff * dt));

    filteredResult.set(
      lastValue.x + alpha * (value.x - lastValue.x),
      lastValue.y + alpha * (value.y - lastValue.y),
      lastValue.z + alpha * (value.z - lastValue.z)
    );

    lastValue.set(filteredResult.x, filteredResult.y, filteredResult.z);
    state.lastTime = timestamp;

    return filteredResult;
  };
}
