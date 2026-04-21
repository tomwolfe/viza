'use client';

import { createContext, useContext, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import type { DetectedObject } from '@/schemas/vision';
import type { WorldObject } from '@/hooks/useWorldMap';
import { useWorldMap } from './useWorldMap';

export interface SpatialContextValue {
  worldMap: WorldObject[];
  detectedObjects: DetectedObject[];
  addOrUpdateObject: (obj: DetectedObject, position: THREE.Vector3) => void;
  clearWorldMap: () => void;
  setDetectedObjects: (objects: DetectedObject[]) => void;
  getDetectedObjects: () => DetectedObject[];
}

const SpatialContext = createContext<SpatialContextValue | null>(null);

export function SpatialProvider({ children }: { children: React.ReactNode }) {
  const { worldMap, addOrUpdateObject, clearWorldMap } = useWorldMap();
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
  const detectedObjectsRef = useRef<DetectedObject[]>([]);

  const setDetectedObjectsCallback = useCallback((objects: DetectedObject[]) => {
    setDetectedObjects(objects);
    detectedObjectsRef.current = objects;
  }, []);

  const getDetectedObjects = useCallback(() => {
    return detectedObjectsRef.current;
  }, []);

  return (
    <SpatialContext.Provider
      value={{
        worldMap,
        detectedObjects,
        addOrUpdateObject,
        clearWorldMap,
        setDetectedObjects: setDetectedObjectsCallback,
        getDetectedObjects,
      }}
    >
      {children}
    </SpatialContext.Provider>
  );
}

export function useSpatial(): SpatialContextValue {
  const context = useContext(SpatialContext);
  if (!context) {
    throw new Error('useSpatial must be used within a SpatialProvider');
  }
  return context;
}

export { SpatialContext };
