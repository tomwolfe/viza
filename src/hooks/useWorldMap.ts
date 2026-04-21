'use client';

import { useRef, useCallback, useEffect, useReducer } from 'react';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { safeGet, safeSet, safeRemove, SCHEMA_VERSION } from '@/utils/safeStorage';
import { CONFIG, logger } from '@/config';
import { createSpatialFilter } from '@/utils/spatial';
import { categorizeObject, generateObjectId, type ObjectCategory } from '@/utils/objectProcessing';

export interface WorldObject {
  id: string;
  name: string;
  position: THREE.Vector3;
  category: ObjectCategory;
  confidence: number;
  lastSeen: number;
  detectionCount: number;
  smoothedPosition: THREE.Vector3;
  isOccluded?: boolean;
  potentiallyMoved?: boolean;
  lastKnownValid?: boolean;
  positionHistory?: THREE.Vector3[];
}

export interface ObjectMatchScore {
  object: WorldObject;
  score: number;
  labelSimilarity: number;
  spatialProximity: number;
  recencyScore: number;
}

interface WorldMapState {
  objects: WorldObject[];
  dampeningFactor: number;
  frameCount: number;
}

type WorldMapAction =
  | { type: 'ADD_OR_UPDATE'; payload: { obj: DetectedObject; position: THREE.Vector3; smoothedPosition: THREE.Vector3; timestamp: number } }
  | { type: 'CLEAR' }
  | { type: 'SET_DAMPENING'; payload: number }
  | { type: 'LOAD'; payload: WorldObject[] }
  | { type: 'TICK_FRAME' }
  | { type: 'UPDATE_OCCLUSION'; payload: { visibleIds: Set<string> } }
  | { type: 'MARK_STALE_OBJECTS'; payload: { cameraPosition: THREE.Vector3; fovRadius: number; timestamp: number } }
  | { type: 'UPDATE_OBJECT_MOVED'; payload: { objectId: string; moved: boolean } };

const DEFAULT_DAMPENING = CONFIG.SPATIAL.DAMPENING_FACTOR;
const STORAGE_KEY = 'viza_world_map';

const FILTER_OPTIONS = {
  minCutoff: CONFIG.SPATIAL.ONE_EURO.MIN_CUTOFF,
  beta: CONFIG.SPATIAL.ONE_EURO.BETA,
  dCutoff: CONFIG.SPATIAL.ONE_EURO.DCUTOFF,
  velocityThreshold: CONFIG.SPATIAL.ONE_EURO.VELOCITY_THRESHOLD,
  staticPrecision: CONFIG.SPATIAL.ONE_EURO.STATIC_PRECISION,
  dynamicSmoothing: CONFIG.SPATIAL.ONE_EURO.DYNAMIC_SMOOTHING,
};

const LABEL_WEIGHT = 0.4;
const DISTANCE_WEIGHT = 0.35;
const RECENCY_WEIGHT = 0.25;
const STALE_THRESHOLD_MS = 5000;
const CONFIDENCE_WEIGHT = 0.3;
const MIN_MATCH_SCORE = 0.5;
const POSITION_HISTORY_SIZE = 5;

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function computeLabelSimilarity(name1: string, name2: string): number {
  const a = name1.toLowerCase().trim();
  const b = name2.toLowerCase().trim();

  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - distance / maxLen);
}

function computeRecencyScore(lastSeen: number, now: number): number {
  const age = now - lastSeen;
  if (age < 0) return 1;
  if (age > STALE_THRESHOLD_MS * 10) return 0;

  return Math.max(0, 1 - age / (STALE_THRESHOLD_MS * 10));
}

function computeSpatialProximity(
  existingPos: THREE.Vector3,
  newPos: THREE.Vector3,
  threshold: number
): number {
  const distance = existingPos.distanceTo(newPos);
  if (distance > threshold) return 0;

  return Math.max(0, 1 - distance / threshold);
}

function computeObjectMatchScore(
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

function findExistingObject(
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

function findExistingObjectWithConfidence(
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

function findAllMatchingObjects(
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

function updateExistingObject(
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

function addNewObject(
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

function worldMapReducer(state: WorldMapState, action: WorldMapAction): WorldMapState {
  switch (action.type) {
    case 'ADD_OR_UPDATE': {
      const { obj, position, smoothedPosition, timestamp } = action.payload;
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
          objects: state.objects.map((o) =>
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
        objects: state.objects.map((obj) => ({
          ...obj,
          isOccluded: !visibleIds.has(obj.id),
        })),
      };
    }

    case 'MARK_STALE_OBJECTS': {
      const { cameraPosition, fovRadius, timestamp } = action.payload;
      const STALE_TIME_MS = 3000;

      return {
        ...state,
        objects: state.objects.map((obj) => {
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
        objects: state.objects.map((obj) =>
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

function loadFromStorage(): WorldObject[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = safeGet<[string, WorldObject][]>({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
    if (stored) {
      return stored.map(([_, value]) => ({
        ...value,
        position: new THREE.Vector3(value.position.x, value.position.y, value.position.z),
        smoothedPosition: new THREE.Vector3(
          value.smoothedPosition?.x ?? value.position.x,
          value.smoothedPosition?.y ?? value.position.y,
          value.smoothedPosition?.z ?? value.position.z
        ),
      }));
    }
  } catch (e) {
    logger.warn('[WorldMap] Failed to load from storage:', e);
  }
  return [];
}

export function saveWorldMapToStorage(objects: WorldObject[]): void {
  const sorted = [...objects].sort((a, b) => b.lastSeen - a.lastSeen);
  const capped = sorted.slice(0, CONFIG.SPATIAL.MAX_WORLD_OBJECTS);

  const data = capped.map((obj) => {
    return [obj.id, obj] as [string, WorldObject];
  });

  try {
    safeSet(data, { key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
  } catch (e) {
    logger.error('[WorldMap] Failed to save to storage:', e);
  }
}

export interface UseWorldMapReturn {
  worldMap: WorldObject[];
  addOrUpdateObject: (obj: DetectedObject, position: THREE.Vector3) => void;
  getObjectAtPosition: (position: THREE.Vector3, threshold: number, name?: string) => WorldObject | null;
  getObjectWithConfidence: (position: THREE.Vector3, threshold: number, name?: string) => WorldObject | null;
  getAllObjects: () => WorldObject[];
  getAllObjectsWithPosition: () => Map<string, { x: number; y: number; z: number; name: string }>;
  clearWorldMap: () => void;
  setDampeningFactor: (factor: number) => void;
  tickFrame: () => void;
  updateOcclusion: (visibleIds: Set<string>) => void;
  markStaleObjects: (cameraPosition: THREE.Vector3, fovRadius: number) => void;
  updateObjectMoved: (objectId: string, moved: boolean) => void;
}

export function useWorldMap(): UseWorldMapReturn {
  const [state, dispatch] = useReducer(worldMapReducer, {
    objects: [],
    dampeningFactor: DEFAULT_DAMPENING,
    frameCount: 0,
  });

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef<Map<string, (value: THREE.Vector3, timestamp: number) => THREE.Vector3>>(new Map());

  useEffect(() => {
    const objects = loadFromStorage();
    if (objects.length > 0) {
      dispatch({ type: 'LOAD', payload: objects });
    }
  }, []);

  const scheduleSave = useCallback((objects: WorldObject[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveWorldMapToStorage(objects);
    }, CONFIG.SPATIAL.SAVE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const addOrUpdateObject = useCallback((obj: DetectedObject, position: THREE.Vector3) => {
    const timestamp = performance.now();
    const key = generateObjectId(obj.name, position);

    let filter = filtersRef.current.get(key);
    if (!filter) {
      filter = createSpatialFilter(new THREE.Vector3(), FILTER_OPTIONS);
      filtersRef.current.set(key, filter);
    }

    const smoothedPosition = filter(position.clone(), timestamp);

    dispatch({
      type: 'ADD_OR_UPDATE',
      payload: { obj, position, smoothedPosition, timestamp }
    });
  }, []);

  const getObjectAtPosition = useCallback(
    (position: THREE.Vector3, threshold: number, name?: string): WorldObject | null => {
      return findExistingObject(state.objects, position, threshold, name);
    },
    [state.objects]
  );

  const getObjectWithConfidence = useCallback(
    (position: THREE.Vector3, threshold: number, name?: string): WorldObject | null => {
      return findExistingObjectWithConfidence(state.objects, position, threshold, name);
    },
    [state.objects]
  );

  const getAllObjects = useCallback((): WorldObject[] => {
    return state.objects;
  }, [state.objects]);

  const getAllObjectsWithPosition = useCallback((): Map<string, { x: number; y: number; z: number; name: string }> => {
    const map = new Map<string, { x: number; y: number; z: number; name: string }>();
    for (const obj of state.objects) {
      map.set(obj.name.toLowerCase(), {
        x: obj.smoothedPosition.x,
        y: obj.smoothedPosition.y,
        z: obj.smoothedPosition.z,
        name: obj.name,
      });
    }
    return map;
  }, [state.objects]);

  const clearWorldMap = useCallback(() => {
    dispatch({ type: 'CLEAR' });
    safeRemove({ key: STORAGE_KEY });
  }, []);

  const setDampeningFactor = useCallback((factor: number) => {
    dispatch({ type: 'SET_DAMPENING', payload: factor });
  }, []);

  const tickFrame = useCallback(() => {
    dispatch({ type: 'TICK_FRAME' });
  }, []);

  const updateOcclusion = useCallback((visibleIds: Set<string>) => {
    dispatch({ type: 'UPDATE_OCCLUSION', payload: { visibleIds } });
  }, []);

  const markStaleObjects = useCallback((cameraPosition: THREE.Vector3, fovRadius: number) => {
    dispatch({
      type: 'MARK_STALE_OBJECTS',
      payload: {
        cameraPosition,
        fovRadius,
        timestamp: performance.now(),
      },
    });
  }, []);

  const updateObjectMoved = useCallback((objectId: string, moved: boolean) => {
    dispatch({
      type: 'UPDATE_OBJECT_MOVED',
      payload: { objectId, moved },
    });
  }, []);

  useEffect(() => {
    if (state.objects.length > 0) {
      scheduleSave(state.objects);
    }
  }, [state.objects, scheduleSave]);

  return {
    worldMap: state.objects,
    addOrUpdateObject,
    getObjectAtPosition,
    getObjectWithConfidence,
    getAllObjects,
    getAllObjectsWithPosition,
    clearWorldMap,
    setDampeningFactor,
    tickFrame,
    updateOcclusion,
    markStaleObjects,
    updateObjectMoved,
  };
}