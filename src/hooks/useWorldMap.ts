'use client';

import { useRef, useCallback, useEffect, useReducer } from 'react';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { safeGet, safeSet, safeRemove, SCHEMA_VERSION } from '@/utils/safeStorage';
import { CONFIG, logger } from '@/config';
import { createOneEuroFilter } from '@/utils/spatial';
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
  filter?: (value: THREE.Vector3, timestamp: number) => THREE.Vector3;
}

interface WorldMapState {
  objects: WorldObject[];
  dampeningFactor: number;
}

type WorldMapAction =
  | { type: 'ADD_OR_UPDATE'; payload: { obj: DetectedObject; position: THREE.Vector3 } }
  | { type: 'CLEAR' }
  | { type: 'SET_DAMPENING'; payload: number }
  | { type: 'LOAD'; payload: WorldObject[] };

const DEFAULT_DAMPENING = CONFIG.SPATIAL.DAMPENING_FACTOR;
const STORAGE_KEY = 'viza_world_map';

const { ONE_EURO } = CONFIG.SPATIAL;

function filterFactory() {
  return createOneEuroFilter(
    new THREE.Vector3(),
    ONE_EURO.MIN_CUTOFF,
    ONE_EURO.BETA,
    ONE_EURO.DCUTOFF
  );
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
      const { obj, position } = action.payload;
      const category = categorizeObject(obj.name, obj.action);
      const timestamp = performance.now();

      const existing = findExistingObject(
        state.objects,
        position,
        CONFIG.SPATIAL.DISTANCE_THRESHOLD,
        obj.name
      );

      if (existing) {
        let filter = existing.filter;
        if (!filter) {
          filter = filterFactory();
          filter(position.clone(), timestamp);
        }

        const filteredPosition = filter(position.clone(), timestamp);

        return {
          ...state,
          objects: state.objects.map((o) =>
            o.id === existing.id
              ? {
                  ...o,
                  position: position.clone(),
                  smoothedPosition: filteredPosition,
                  filter,
                  category: category !== 'unknown' ? category : o.category,
                  confidence: obj.confidence ?? o.confidence,
                  lastSeen: Date.now(),
                  detectionCount: o.detectionCount + 1,
                }
              : o
          ),
        };
      } else {
        const key = generateObjectId(obj.name, position);
        const filter = filterFactory();
        filter(position.clone(), timestamp);

        const newObj: WorldObject = {
          id: key,
          name: obj.name,
          position: position.clone(),
          smoothedPosition: position.clone(),
          category,
          confidence: obj.confidence ?? 1,
          lastSeen: Date.now(),
          detectionCount: 1,
          filter,
        };

        const newObjects = [...state.objects, newObj];

        if (newObjects.length > CONFIG.SPATIAL.MAX_WORLD_OBJECTS) {
          newObjects.sort((a, b) => b.lastSeen - a.lastSeen);
          newObjects.splice(CONFIG.SPATIAL.MAX_WORLD_OBJECTS);
        }

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
        filter: filterFactory(),
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
    const { filter, ...serializableObj } = obj;
    return [serializableObj.id, serializableObj] as [string, WorldObject];
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
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const addOrUpdateObject = useCallback((obj: DetectedObject, position: THREE.Vector3) => {
    dispatch({ type: 'ADD_OR_UPDATE', payload: { obj, position } });
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