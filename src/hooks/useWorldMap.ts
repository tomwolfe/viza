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
}

interface WorldMapState {
  objects: WorldObject[];
  dampeningFactor: number;
}

type WorldMapAction =
  | { type: 'ADD_OR_UPDATE'; payload: { obj: DetectedObject; position: THREE.Vector3; smoothedPosition: THREE.Vector3; timestamp: number } }
  | { type: 'CLEAR' }
  | { type: 'SET_DAMPENING'; payload: number }
  | { type: 'LOAD'; payload: WorldObject[] };

const DEFAULT_DAMPENING = CONFIG.SPATIAL.DAMPENING_FACTOR;
const STORAGE_KEY = 'viza_world_map';

const FILTER_OPTIONS = {
  minCutoff: CONFIG.SPATIAL.ONE_EURO.MIN_CUTOFF,
  beta: CONFIG.SPATIAL.ONE_EURO.BETA,
  dCutoff: CONFIG.SPATIAL.ONE_EURO.DCUTOFF,
};

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

function updateExistingObject(
  existing: WorldObject,
  position: THREE.Vector3,
  smoothedPosition: THREE.Vector3,
  category: ObjectCategory,
  confidence: number | undefined,
  timestamp: number,
  detectionCount: number
): WorldObject {
  return {
    ...existing,
    position: position.clone(),
    smoothedPosition: smoothedPosition.clone(),
    category: category !== 'unknown' ? category : existing.category,
    confidence: confidence ?? existing.confidence,
    lastSeen: timestamp,
    detectionCount: existing.detectionCount + 1,
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
        };

        const newObjects = addNewObject(newObj, state.objects);

        return {
          ...state,
          objects: newObjects,
        };
      }
    }

    case 'CLEAR':
      return { ...state, objects: [] };

    case 'SET_DAMPENING':
      return { ...state, dampeningFactor: Math.max(0, Math.min(1, action.payload)) };

    case 'LOAD':
      return { ...state, objects: action.payload };

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
  getAllObjects: () => WorldObject[];
  clearWorldMap: () => void;
  setDampeningFactor: (factor: number) => void;
}

export function useWorldMap(): UseWorldMapReturn {
  const [state, dispatch] = useReducer(worldMapReducer, {
    objects: [],
    dampeningFactor: DEFAULT_DAMPENING,
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

  const getAllObjects = useCallback((): WorldObject[] => {
    return state.objects;
  }, [state.objects]);

  const clearWorldMap = useCallback(() => {
    dispatch({ type: 'CLEAR' });
    safeRemove({ key: STORAGE_KEY });
  }, []);

  const setDampeningFactor = useCallback((factor: number) => {
    dispatch({ type: 'SET_DAMPENING', payload: factor });
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
    getAllObjects,
    clearWorldMap,
    setDampeningFactor,
  };
}