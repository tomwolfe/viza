import * as THREE from 'three';

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

export function projectBoundingBoxToWorld(
  bbox: BoundingBox2D,
  options: ProjectToWorldOptions
): WorldPosition {
  const { camera, imageWidth, imageHeight, depth = -3 } = options;

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