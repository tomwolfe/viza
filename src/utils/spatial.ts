import * as THREE from 'three';
import { CONFIG } from '@/config';

export interface BoundingBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

interface ProjectToWorldOptions {
  camera: THREE.Camera;
  viewport: THREE.Vector3;
  imageWidth: number;
  imageHeight: number;
  depth?: number;
}

export interface HitTestResult {
  distance: number;
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
}

export function get3DPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
  targetSize: number,
  depth: number,
  hitTestResult?: HitTestResult
): THREE.Vector3 {
  if (hitTestResult) {
    const hitPosition = hitTestResult.position.clone();
    hitPosition.x += (x / targetSize - 0.5) * 0.3;
    hitPosition.y += (y / targetSize - 0.5) * 0.3;
    return hitPosition;
  }

  const aspect = viewport.width / viewport.height;
  const scale = aspect > 1 ? 1 : aspect;
  const offsetX = aspect > 1 ? 0 : (1 - scale) / 2;
  const offsetY = aspect > 1 ? (1 - scale) / 2 : 0;

  return new THREE.Vector3(
    ((x / targetSize) - offsetX) / scale * viewport.width,
    -(((y / targetSize) - offsetY) / scale * viewport.height),
    depth
  );
}

export function projectBoundingBoxToWorld(
  bbox: BoundingBox2D,
  options: ProjectToWorldOptions
): WorldPosition {
  const { camera, imageWidth, imageHeight, depth = CONFIG.SPATIAL.DEFAULT_DEPTH } = options;

  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;

  const normalizedX = (centerX / imageWidth) * 2 - 1;
  const normalizedY = (centerY / imageHeight) * 2 - 1;

  const vector = new THREE.Vector3(normalizedX, normalizedY, 0.5);
  vector.unproject(camera);

  const direction = vector.sub(camera.position).normalize();
  const distance = -depth / direction.z;
  const position = camera.position.clone().add(direction.multiplyScalar(distance));

  return {
    x: position.x,
    y: position.y,
    z: position.z,
  };
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

export function calculateDistance2D(
  pos1: { x: number; y: number },
  pos2: { x: number; y: number }
): number {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculateDistance3D(
  pos1: { x: number; y: number; z: number },
  pos2: { x: number; y: number; z: number }
): number {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  const dz = pos2.z - pos1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function isWithinThreshold(
  pos1: THREE.Vector3,
  pos2: THREE.Vector3,
  threshold: number
): boolean {
  return pos1.distanceTo(pos2) < threshold;
}

export function lerpPosition(
  current: THREE.Vector3,
  target: THREE.Vector3,
  factor: number
): THREE.Vector3 {
  return current.clone().lerp(target, factor);
}

export function smoothPosition(
  current: THREE.Vector3,
  target: THREE.Vector3,
  dampening: number,
  maxSpeed?: number
): THREE.Vector3 {
  const delta = target.clone().sub(current);
  const distance = delta.length();
  
  if (maxSpeed && distance > maxSpeed) {
    delta.normalize().multiplyScalar(maxSpeed);
  }
  
  return current.clone().add(delta.multiplyScalar(dampening));
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
  let state: OneEuroFilterState = {
    lastValue: initialValue.clone(),
    lastTime: 0,
  };

  return (value: THREE.Vector3, timestamp: number) => {
    if (state.lastTime === 0) {
      state.lastValue = value.clone();
      state.lastTime = timestamp;
      return value.clone();
    }

    const dt = (timestamp - state.lastTime) / 1000;
    if (dt <= 0) {
      return state.lastValue.clone();
    }

    const dx = (value.x - state.lastValue.x) / dt;
    const dy = (value.y - state.lastValue.y) / dt;
    const dz = (value.z - state.lastValue.z) / dt;

    const rate = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cutoff = minCutoff + beta * Math.max(0, rate - dCutoff);
    const alpha = Math.min(1, (cutoff * dt) / (1 + cutoff * dt));

    const filtered = new THREE.Vector3(
      state.lastValue.x + alpha * (value.x - state.lastValue.x),
      state.lastValue.y + alpha * (value.y - state.lastValue.y),
      state.lastValue.z + alpha * (value.z - state.lastValue.z)
    );

    state.lastValue = filtered;
    state.lastTime = timestamp;

    return filtered;
  };
}