import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { categorizeObject, generateObjectId, type ObjectCategory } from '@/utils/objectProcessing';
import { CONFIG } from '@/config';
import type { WorldObject, ObjectMatchScore, WorldMapState, WorldMapAction } from '../hooks/useWorldMap';
import { levenshteinDistance, computeLabelSimilarity } from './stringUtils';

export const LABEL_WEIGHT = 0.4;
export const DISTANCE_WEIGHT = 0.35;
export const RECENCY_WEIGHT = 0.25;
export const STALE_THRESHOLD_MS = 5000;
export const CONFIDENCE_WEIGHT = 0.3;
export const MIN_MATCH_SCORE = 0.5;
export const POSITION_HISTORY_SIZE = 5;
export const STALE_TIME_MS = 3000;

export function computeRecencyScore(lastSeen: number, now: number): number {
  const age = now - lastSeen;
  if (age < 0) return 1;
  if (age > STALE_THRESHOLD_MS * 10) return 0;

  return Math.max(0, 1 - age / (STALE_THRESHOLD_MS * 10));
}

export function computeSpatialProximity(
  existingPos: THREE.Vector3,
  newPos: THREE.Vector3,
  threshold: number
): number {
  const distance = existingPos.distanceTo(newPos);
  if (distance > threshold) return 0;

  return Math.max(0, 1 - distance / threshold);
}

export function computeObjectMatchScore(
  obj: WorldObject,
  position: THREE.Vector3,
  name: string | undefined,
  threshold: number,
  now: number
): ObjectMatchScore {
  let labelSimilarity = 1;
  if (name) {
    labelSimilarity = computeLabelSimilarity(obj.name, name);
  }

  const spatialProximity = computeSpatialProximity(obj.smoothedPosition, position, threshold);
  const recencyScore = computeRecencyScore(obj.lastSeen, now);
  const confidenceScore = obj.confidence;

  const totalScore =
    labelSimilarity * LABEL_WEIGHT +
    spatialProximity * DISTANCE_WEIGHT +
    recencyScore * RECENCY_WEIGHT +
    confidenceScore * CONFIDENCE_WEIGHT;

  return {
    object: obj,
    score: totalScore,
    labelSimilarity,
    spatialProximity,
    recencyScore,
  };
}

export function findExistingObject(
  objects: WorldObject[],
  position: THREE.Vector3,
  threshold: number,
  name?: string
): WorldObject | null {
  for (const obj of objects) {
    const distance = obj.smoothedPosition.distanceTo(position);
    if (distance < threshold) {
      if (name && obj.name.toLowerCase() !== name.toLowerCase()) continue;
      return obj;
    }
  }
  return null;
}

export function findExistingObjectWithConfidence(
  objects: WorldObject[],
  position: THREE.Vector3,
  threshold: number,
  name?: string,
  minScore: number = MIN_MATCH_SCORE
): WorldObject | null {
  const now = performance.now();
  let bestMatch: ObjectMatchScore | null = null;

  for (const obj of objects) {
    const match = computeObjectMatchScore(obj, position, name, threshold, now);

    if (match.score > (bestMatch?.score ?? 0)) {
      bestMatch = match;
    }
  }

  if (bestMatch && bestMatch.score >= minScore) {
    return bestMatch.object;
  }

  return null;
}

export function findAllMatchingObjects(
  objects: WorldObject[],
  position: THREE.Vector3,
  threshold: number,
  name?: string,
  minScore: number = MIN_MATCH_SCORE
): ObjectMatchScore[] {
  const now = performance.now();
  const matches: ObjectMatchScore[] = [];

  for (const obj of objects) {
    const match = computeObjectMatchScore(obj, position, name, threshold, now);
    if (match.score >= minScore) {
      matches.push(match);
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function updateExistingObject(
  existing: WorldObject,
  position: THREE.Vector3,
  smoothedPosition: THREE.Vector3,
  category: ObjectCategory,
  confidence: number | undefined,
  timestamp: number,
  detectionCount: number
): WorldObject {
  const newHistory = [...(existing.positionHistory || []), smoothedPosition.clone()];
  if (newHistory.length > POSITION_HISTORY_SIZE) {
    newHistory.shift();
  }

  return {
    ...existing,
    position: position.clone(),
    smoothedPosition: smoothedPosition.clone(),
    category: category !== 'unknown' ? category : existing.category,
    confidence: confidence ?? existing.confidence,
    lastSeen: timestamp,
    detectionCount: existing.detectionCount + 1,
    potentiallyMoved: false,
    lastKnownValid: true,
    positionHistory: newHistory,
  };
}

export function addNewObject(
  newObj: WorldObject,
  currentObjects: WorldObject[]
): WorldObject[] {
  const newObjects = [...currentObjects, newObj];

  if (newObjects.length > CONFIG.SPATIAL.MAX_WORLD_OBJECTS) {
    newObjects.sort((a, b) => b.lastSeen - a.lastSeen);
    newObjects.splice(CONFIG.SPATIAL.MAX_WORLD_OBJECTS);
  }

  return newObjects;
}

export function findExistingObjectKey(
  objects: Map<string, WorldObject>,
  position: THREE.Vector3,
  threshold: number,
  name?: string
): string | null {
  for (const [key, obj] of objects) {
    const distance = obj.smoothedPosition.distanceTo(position);
    if (distance < threshold) {
      if (name && obj.name.toLowerCase() !== name.toLowerCase()) continue;
      return key;
    }
  }
  return null;
}

export function worldMapReducer(state: WorldMapState, action: WorldMapAction): WorldMapState {
  switch (action.type) {
    case 'ADD_OR_UPDATE': {
      const { obj, position, smoothedPosition, timestamp, anchorId } = action.payload;
      const category = categorizeObject(obj.name, obj.action);

      const existing = findExistingObject(
        state.objects,
        position,
        CONFIG.SPATIAL.DISTANCE_THRESHOLD,
        obj.name
      );

      if (existing) {
        return {
          ...state,
          objects: state.objects.map((o: WorldObject) =>
            o.id === existing.id
              ? updateExistingObject(
                  o,
                  position,
                  smoothedPosition,
                  category,
                  obj.confidence,
                  timestamp,
                  o.detectionCount
                )
              : o
          ),
        };
      } else {
        const key = generateObjectId(obj.name, position);

        const newObj: WorldObject = {
          id: key,
          name: obj.name,
          position: position.clone(),
          smoothedPosition: smoothedPosition.clone(),
          category,
          confidence: obj.confidence ?? 1,
          lastSeen: timestamp,
          detectionCount: 1,
          isOccluded: false,
          anchorId: anchorId,
        };

        const newObjects = addNewObject(newObj, state.objects);

        return {
          ...state,
          objects: newObjects,
        };
      }
    }

    case 'CLEAR':
      return { ...state, objects: [], frameCount: 0 };

    case 'SET_DAMPENING':
      return { ...state, dampeningFactor: Math.max(0, Math.min(1, action.payload)) };

    case 'LOAD':
      return { ...state, objects: action.payload };

    case 'TICK_FRAME':
      return { ...state, frameCount: state.frameCount + 1 };

    case 'UPDATE_OCCLUSION': {
      const visibleIds = action.payload.visibleIds;
      return {
        ...state,
        objects: state.objects.map((obj: WorldObject) => ({
          ...obj,
          isOccluded: !visibleIds.has(obj.id),
        })),
      };
    }

    case 'MARK_STALE_OBJECTS': {
      const { cameraPosition, fovRadius, timestamp } = action.payload;

      return {
        ...state,
        objects: state.objects.map((obj: WorldObject) => {
          const distance = obj.smoothedPosition.distanceTo(cameraPosition);
          const isInFov = distance <= fovRadius;
          const timeSinceLastSeen = timestamp - obj.lastSeen;

          if (isInFov && timeSinceLastSeen > STALE_TIME_MS) {
            return {
              ...obj,
              potentiallyMoved: true,
              lastKnownValid: obj.lastKnownValid ?? false,
            };
          }

          if (!isInFov) {
            return {
              ...obj,
              potentiallyMoved: false,
            };
          }

          return obj;
        }),
      };
    }

    case 'UPDATE_OBJECT_MOVED': {
      const { objectId, moved } = action.payload;
      return {
        ...state,
        objects: state.objects.map((obj: WorldObject) =>
          obj.id === objectId
            ? { ...obj, potentiallyMoved: moved, lastKnownValid: !moved }
            : obj
        ),
      };
    }

    default:
      return state;
  }
}