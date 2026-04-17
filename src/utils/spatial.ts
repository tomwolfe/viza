import * as THREE from 'three';
import { CONFIG } from '@/config';

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

export interface Get3DPositionOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  camera: THREE.PerspectiveCamera;
  viewport: { width: number; height: number };
  targetSize: number;
  depth: number;
  hitTestResult?: HitTestResult;
  cameraOffset?: THREE.Vector3;
  targetVector?: THREE.Vector3;
}

export function get3DPosition({
  x,
  y,
  width,
  height,
  camera,
  viewport,
  targetSize,
  depth,
  hitTestResult,
  cameraOffset,
  targetVector,
}: Get3DPositionOptions): THREE.Vector3 {
  const result = targetVector || new THREE.Vector3();

  if (hitTestResult) {
    result.copy(hitTestResult.position);
    result.x += (x / targetSize - 0.5) * CONFIG.SPATIAL.HIT_TEST_OFFSET;
    result.y += (y / targetSize - 0.5) * CONFIG.SPATIAL.HIT_TEST_OFFSET;
    return result;
  }

  const aspect = viewport.width / viewport.height;
  const scale = aspect > 1 ? 1 : aspect;
  const offsetX = aspect > 1 ? 0 : (1 - scale) / 2;
  const offsetY = aspect > 1 ? (1 - scale) / 2 : 0;

  const relX = ((x / targetSize) - offsetX) / scale * viewport.width;
  const relY = -(((y / targetSize) - offsetY) / scale * viewport.height);

  const cameraPosition = cameraOffset || camera.position;
  
  return result.set(
    cameraPosition.x + relX,
    cameraPosition.y + relY,
    cameraPosition.z + depth
  );
}

export function projectBoundingBoxSize(
  bbox: BoundingBox2D,
  camera: THREE.PerspectiveCamera,
  imageWidth: number,
  imageHeight: number,
  worldDepth: number
): { width: number; height: number } {
  const aspectRatio = imageWidth / imageHeight;

  const widthRatio = bbox.width / imageWidth;
  const heightRatio = bbox.height / imageHeight;

  const fov = (camera.fov * Math.PI) / 180;
  const projectedWidth = widthRatio * fov * Math.abs(worldDepth) * aspectRatio;
  const projectedHeight = heightRatio * fov * Math.abs(worldDepth);

  return {
    width: projectedWidth,
    height: projectedHeight,
  };
}

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