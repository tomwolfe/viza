'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { safeGet, safeSet, safeRemove, SCHEMA_VERSION } from '@/utils/safeStorage';
import { CONFIG, logger } from '@/config';
import { createOneEuroFilter } from '@/utils/spatial';

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

export type ObjectCategory = 'tool' | 'trash' | 'clutter' | 'keep' | 'unknown';

export interface UseWorldMapReturn {
  worldMap: Map<string, WorldObject>;
  addOrUpdateObject: (obj: DetectedObject, position: THREE.Vector3) => void;
  getObjectAtPosition: (position: THREE.Vector3, threshold: number, name?: string) => WorldObject | null;
  getAllObjects: () => WorldObject[];
  clearWorldMap: () => void;
  setDampeningFactor: (factor: number) => void;
}

const DEFAULT_DAMPENING = CONFIG.SPATIAL.DAMPENING_FACTOR;
const STORAGE_KEY = 'viza_world_map';

function categorizeObject(name: string, action?: string): ObjectCategory {
  const lower = name.toLowerCase();
  const actionLower = (action || '').toLowerCase();

  if (actionLower.includes('throw') || actionLower.includes('discard') || actionLower.includes('trash')) {
    return 'trash';
  }
  if (actionLower.includes('clean') || actionLower.includes('organize') || actionLower.includes('put away')) {
    return 'clutter';
  }
  if (actionLower.includes('keep') || actionLower.includes('save')) {
    return 'keep';
  }

  const toolKeywords = CONFIG.CATEGORIES.TOOL.keywords;
  const trashKeywords = CONFIG.CATEGORIES.TRASH.keywords;
  const clutterKeywords = CONFIG.CATEGORIES.CLUTTER.keywords;

  if (toolKeywords.some(k => lower.includes(k))) return 'tool';
  if (trashKeywords.some(k => lower.includes(k))) return 'trash';
  if (clutterKeywords.some(k => lower.includes(k))) return 'clutter';

  return 'unknown';
}

function generateObjectId(name: string, position: THREE.Vector3): string {
  const normalized = `${name.toLowerCase().replace(/\s+/g, '-')}`;
  return normalized;
}

function loadWorldMapFromStorage(): Map<string, WorldObject> {
  const map = new Map<string, WorldObject>();
  if (typeof window === 'undefined') return map;

  try {
    const stored = safeGet<[string, WorldObject][]>({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
    if (stored) {
      stored.forEach(([key, value]) => {
        map.set(key, {
          ...value,
          position: new THREE.Vector3(value.position.x, value.position.y, value.position.z),
          smoothedPosition: new THREE.Vector3(
            value.smoothedPosition?.x ?? value.position.x,
            value.smoothedPosition?.y ?? value.position.y,
            value.smoothedPosition?.z ?? value.position.z
          ),
          filter: filterFactory(),
        });
      });
    }
  } catch (e) {
    logger.warn('[WorldMap] Failed to load from storage:', e);
  }
  return map;
}

function saveWorldMapToStorage(map: Map<string, WorldObject>): void {
  const data = Array.from(map.entries());
  try {
    safeSet(data, { key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
  } catch (e) {
    logger.error('[WorldMap] Failed to save to storage:', e);
  }
}

const { ONE_EURO } = CONFIG.SPATIAL;
const filterFactory = () => createOneEuroFilter(
  new THREE.Vector3(),
  ONE_EURO.MIN_CUTOFF,
  ONE_EURO.BETA,
  ONE_EURO.DCUTOFF
);

export function useWorldMap(): UseWorldMapReturn {
  const worldMapRef = useRef<Map<string, WorldObject>>(loadWorldMapFromStorage());
  const dampeningRef = useRef(DEFAULT_DAMPENING);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterCacheRef = useRef<Map<string, (value: THREE.Vector3, timestamp: number) => THREE.Vector3>>(new Map());
  const [, setVersion] = useState(0);

  useEffect(() => {
    const map = worldMapRef.current;
    if (map.size > 0) {
      saveWorldMapToStorage(map);
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveWorldMapToStorage(worldMapRef.current);
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
    const map = worldMapRef.current;
    const category = categorizeObject(obj.name, obj.action);

    const existingKey = findExistingObjectKey(map, position, CONFIG.SPATIAL.DISTANCE_THRESHOLD, obj.name);
    const timestamp = performance.now();

    if (existingKey) {
      const existing = map.get(existingKey)!;
      
      let filter = existing.filter;
      if (!filter) {
        filter = filterFactory();
        filter(position.clone(), timestamp);
      }
      
      const filteredPosition = filter(position.clone(), timestamp);
      
      const updated: WorldObject = {
        ...existing,
        position: position.clone(),
        smoothedPosition: filteredPosition,
        filter,
        category: category !== 'unknown' ? category : existing.category,
        confidence: obj.confidence ?? existing.confidence,
        lastSeen: Date.now(),
        detectionCount: existing.detectionCount + 1,
      };
      map.set(existingKey, updated);
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
      map.set(key, newObj);
    }

    scheduleSave();
    setVersion(v => v + 1);
  }, [scheduleSave]);

  const getObjectAtPosition = useCallback((position: THREE.Vector3, threshold: number, name?: string): WorldObject | null => {
    const map = worldMapRef.current;
    const key = findExistingObjectKey(map, position, threshold, name);
    return key ? map.get(key) ?? null : null;
  }, []);

  const getAllObjects = useCallback((): WorldObject[] => {
    return Array.from(worldMapRef.current.values());
  }, []);

  const clearWorldMap = useCallback(() => {
    worldMapRef.current.clear();
    safeRemove({ key: STORAGE_KEY });
  }, []);

  const setDampeningFactor = useCallback((factor: number) => {
    dampeningRef.current = Math.max(0, Math.min(1, factor));
  }, []);

  return {
    worldMap: worldMapRef.current,
    addOrUpdateObject,
    getObjectAtPosition,
    getAllObjects,
    clearWorldMap,
    setDampeningFactor,
  };
}

function findExistingObjectKey(map: Map<string, WorldObject>, position: THREE.Vector3, threshold: number, name?: string): string | null {
  for (const [key, obj] of map.entries()) {
    const distance = obj.smoothedPosition.distanceTo(position);
    if (distance < threshold) {
      if (name && obj.name.toLowerCase() !== name.toLowerCase()) continue;
      return key;
    }
  }
  return null;
}

export function getCategoryColor(category: ObjectCategory): string {
  switch (category) {
    case 'trash':
      return '#ff4444';
    case 'clutter':
      return '#ffaa00';
    case 'keep':
      return '#44ff44';
    case 'tool':
      return '#4488ff';
    case 'unknown':
    default:
      return '#00ff88';
  }
}

export function getCategoryLabel(category: ObjectCategory): string {
  switch (category) {
    case 'trash':
      return 'Trash';
    case 'clutter':
      return 'Clutter';
    case 'keep':
      return 'Keep';
    case 'tool':
      return 'Tool';
    case 'unknown':
    default:
      return 'Unknown';
  }
}
