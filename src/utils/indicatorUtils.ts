import * as THREE from 'three';

export interface IndicatorPosition {
  position: THREE.Vector3;
  screenPos: { x: number; y: number };
  isOnScreen: boolean;
  angle: number;
  distance: number;
  isStale?: boolean;
}

export function projectPositionToScreen(
  position: THREE.Vector3,
  camera: THREE.Camera,
  screenWidth: number,
  screenHeight: number
): { x: number; y: number; isOnScreen: boolean } {
  const projected = position.clone().project(camera);
  
  const isOnScreen = 
    projected.x >= -1 &&
    projected.x <= 1 &&
    projected.y >= -1 &&
    projected.y <= 1;
  
  const screenX = (projected.x + 1) / 2 * screenWidth;
  const screenY = (-projected.y + 1) / 2 * screenHeight;
  
  return { x: screenX, y: screenY, isOnScreen };
}

export function calculateIndicatorScreenPosition(
  screenX: number,
  screenY: number,
  screenWidth: number,
  screenHeight: number,
  edgeMargin: number
): { x: number; y: number; angleToCenter: number } {
  const clampedX = Math.max(
    edgeMargin,
    Math.min(screenWidth - edgeMargin, screenX)
  );
  const clampedY = Math.max(
    edgeMargin,
    Math.min(screenHeight - edgeMargin, screenY)
  );
  
  const angleToCenter = Math.atan2(
    screenHeight / 2 - clampedY,
    screenWidth / 2 - clampedX
  );
  
  return { x: clampedX, y: clampedY, angleToCenter };
}

export function calculateOffScreenIndicator(
  targetPos: THREE.Vector3,
  camera: THREE.Camera,
  screenWidth: number,
  screenHeight: number,
  edgeMargin: number,
  breadcrumbs?: THREE.Vector3[]
): { x: number; y: number; angle: number; distance: number; pathPoints: { x: number; y: number }[] } | null {
  const projected = targetPos.clone().project(camera);
  
  if (projected.z < 0 || projected.z > 1) {
    return null;
  }
  
  const screenX = (projected.x + 1) / 2 * screenWidth;
  const screenY = (-projected.y + 1) / 2 * screenHeight;
  
  const isOnScreen = 
    screenX >= 0 && screenX <= screenWidth && screenY >= 0 && screenY <= screenHeight;
  
  if (isOnScreen) return null;
  
  const centerX = screenWidth / 2;
  const centerY = screenHeight / 2;
  
  const dx = screenX - centerX;
  const dy = screenY - centerY;
  
  const edgeX =
    dx > 0
      ? Math.min(screenX, screenWidth - edgeMargin)
      : Math.max(screenX, edgeMargin);
  const edgeY =
    dy > 0
      ? Math.min(screenY, screenHeight - edgeMargin)
      : Math.max(screenY, edgeMargin);
  
  const clampedEdgeX = Math.abs(dx) > Math.abs(dy)
    ? edgeX
    : dx === 0
    ? centerX
    : centerX + (edgeX - centerX) * Math.abs(dy / dx);
  const clampedEdgeY = Math.abs(dy) > Math.abs(dx)
    ? edgeY
    : dy === 0
    ? centerY
    : centerY + (edgeY - centerY) * Math.abs(dx / dy);
  
  const pathPoints: { x: number; y: number }[] = [];
  if (breadcrumbs && breadcrumbs.length > 1) {
    for (const breadcrumb of breadcrumbs) {
      const breadcrumbProjected = breadcrumb.clone().project(camera);
      if (breadcrumbProjected.z >= 0 && breadcrumbProjected.z <= 1) {
        pathPoints.push({
          x: (breadcrumbProjected.x + 1) / 2 * screenWidth,
          y: (-breadcrumbProjected.y + 1) / 2 * screenHeight,
        });
      }
    }
  }
  
  return {
    x: clampedEdgeX,
    y: clampedEdgeY,
    angle: Math.atan2(screenY - centerY, screenX - centerX),
    distance: targetPos.distanceTo(camera.position),
    pathPoints,
  };
}

export interface BreadcrumbPoint {
  position: THREE.Vector3;
  timestamp: number;
}

export function updateBreadcrumbs(
  breadcrumbsRef: React.MutableRefObject<Map<string, BreadcrumbPoint[]>>,
  objectId: string,
  position: THREE.Vector3,
  now: number,
  maxBreadcrumbs: number,
  intervalMs: number
): void {
  const objBreadcrumbs = breadcrumbsRef.current.get(objectId) || [];
  if (objBreadcrumbs.length === 0 ||
      now - objBreadcrumbs[objBreadcrumbs.length - 1].timestamp > intervalMs) {
    objBreadcrumbs.push({
      position: position.clone(),
      timestamp: now,
    });
    if (objBreadcrumbs.length > maxBreadcrumbs) {
      objBreadcrumbs.shift();
    }
    breadcrumbsRef.current.set(objectId, objBreadcrumbs);
  }
}

export function computeBreadcrumbLines(
  breadcrumbsRef: React.MutableRefObject<Map<string, BreadcrumbPoint[]>>
): { points: THREE.Vector3[]; id: string }[] {
  const lines: { points: THREE.Vector3[]; id: string }[] = [];
  
  for (const [objId, crumbs] of breadcrumbsRef.current) {
    if (crumbs.length < 2) continue;
    const points = crumbs.map(c => c.position);
    lines.push({ points, id: objId });
  }
  
  return lines;
}