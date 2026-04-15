'use client';

import { useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import { safeGet, safeSet, safeRemove, SCHEMA_VERSION } from '@/utils/safeStorage';
import { CONFIG, logger } from '@/config';

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

export type ObjectCategory = 'tool' | 'trash' | 'clutter' | 'keep' | 'unknown';

export interface UseWorldMapReturn {
  worldMap: Map<string, WorldObject>;
  addOrUpdateObject: (obj: DetectedObject, position: THREE.Vector3) => void;
  getObjectAtPosition: (position: THREE.Vector3, threshold: number) => WorldObject | null;
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
  return `${name.toLowerCase().replace(/\s+/g, '-')}_${Math.round(position.x * 10)}_${Math.round(position.y * 10)}_${Math.round(position.z * 10)}`;
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
  safeSet(data, { key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION });
}

export function useWorldMap(): UseWorldMapReturn {
  const worldMapRef = useRef<Map<string, WorldObject>>(loadWorldMapFromStorage());
  const dampeningRef = useRef(DEFAULT_DAMPENING);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }, 1000);
  }, []);

  const addOrUpdateObject = useCallback((obj: DetectedObject, position: THREE.Vector3) => {
    const map = worldMapRef.current;
    const category = categorizeObject(obj.name, obj.action);

    const existingKey = findExistingObjectKey(map, position, CONFIG.SPATIAL.DISTANCE_THRESHOLD);

    if (existingKey) {
      const existing = map.get(existingKey)!;
      const smoothed = existing.smoothedPosition.clone().lerp(position, dampeningRef.current);
      const updated: WorldObject = {
        ...existing,
        position: position.clone(),
        smoothedPosition: smoothed,
        category: category !== 'unknown' ? category : existing.category,
        confidence: obj.confidence ?? existing.confidence,
        lastSeen: Date.now(),
        detectionCount: existing.detectionCount + 1,
      };
      map.set(existingKey, updated);
    } else {
      const key = generateObjectId(obj.name, position);
      const newObj: WorldObject = {
        id: key,
        name: obj.name,
        position: position.clone(),
        smoothedPosition: position.clone(),
        category,
        confidence: obj.confidence ?? 1,
        lastSeen: Date.now(),
        detectionCount: 1,
      };
      map.set(key, newObj);
    }

    scheduleSave();
  }, [scheduleSave]);

  const getObjectAtPosition = useCallback((position: THREE.Vector3, threshold: number): WorldObject | null => {
    const map = worldMapRef.current;
    return findExistingObjectKey(map, position, threshold) ? map.get(findExistingObjectKey(map, position, threshold)!) ?? null : null;
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

function findExistingObjectKey(map: Map<string, WorldObject>, position: THREE.Vector3, threshold: number): string | null {
  for (const [key, obj] of map.entries()) {
    const distance = obj.smoothedPosition.distanceTo(position);
    if (distance < threshold) {
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
