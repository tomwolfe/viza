'use client';

import { useRef, useCallback, useEffect, useReducer } from 'react';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { safeGet, safeSet, safeRemove, SCHEMA_VERSION } from '@/utils/safeStorage';
import { CONFIG, logger } from '@/config';
import { createSpatialFilter } from '@/utils/spatial';
import { generateObjectId, type ObjectCategory } from '@/utils/objectProcessing';
import { worldMapReducer, findExistingObject, findExistingObjectWithConfidence, findExistingObjectKey as findExistingObjectKeyLogic } from '@/utils/worldMapLogic';

export { findExistingObjectKeyLogic as findExistingObjectKey };

export interface WorldObject {
  id: string;
  name: string;
  position: THREE.Vector3;
  category: ObjectCategory;
  confidence: number;
  lastSeen: number;
  detectionCount: number;
  smoothedPosition: THREE.Vector3;
  anchorId?: string;
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

export interface WorldMapState {
  objects: WorldObject[];
  dampeningFactor: number;
  frameCount: number;
}

export type WorldMapAction =
  | { type: 'ADD_OR_UPDATE'; payload: { obj: DetectedObject; position: THREE.Vector3; smoothedPosition: THREE.Vector3; timestamp: number; anchorId?: string } }
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
  addOrUpdateObject: (obj: DetectedObject, position: THREE.Vector3, anchorId?: string) => void;
  getObjectAtPosition: (position: THREE.Vector3, threshold: number, name?: string) => WorldObject | null;
  getObjectWithConfidence: (position: THREE.Vector3, threshold: number, name?: string) => WorldObject | null;
  getAllObjects: () => WorldObject[];
  getAllObjectsWithPosition: () => Map<string, { x: number; y: number; z: number; name: string; anchorId?: string }>;
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

  const addOrUpdateObject = useCallback((obj: DetectedObject, position: THREE.Vector3, anchorId?: string) => {
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
      payload: { obj, position, smoothedPosition, timestamp, anchorId }
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

  const getAllObjectsWithPosition = useCallback((): Map<string, { x: number; y: number; z: number; name: string; anchorId?: string }> => {
    const map = new Map<string, { x: number; y: number; z: number; name: string; anchorId?: string }>();
    for (const obj of state.objects) {
      map.set(obj.name.toLowerCase(), {
        x: obj.smoothedPosition.x,
        y: obj.smoothedPosition.y,
        z: obj.smoothedPosition.z,
        name: obj.name,
        anchorId: obj.anchorId,
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