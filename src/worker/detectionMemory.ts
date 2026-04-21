export interface DetectionMemoryObject {
  name: string;
  position: { x: number; y: number; z: number };
  timestamp: number;
  category: string;
}

export interface DetectionMemory {
  objects: DetectionMemoryObject[];
  lastUpdate: number;
}

export const DETECTION_MEMORY_SIZE = 10;
export const MEMORY_RETENTION_MS = 60000;

export function createDetectionMemory(): DetectionMemory {
  return {
    objects: [],
    lastUpdate: 0,
  };
}

export function updateDetectionMemory(
  memory: DetectionMemory,
  objects: { name: string; position: { x: number; y: number; z: number }; category?: string }[]
): void {
  const now = performance.now();

  for (const obj of objects) {
    const existingIndex = memory.objects.findIndex(
      m => m.name.toLowerCase() === obj.name.toLowerCase()
    );

    if (existingIndex >= 0) {
      memory.objects[existingIndex] = {
        name: obj.name,
        position: obj.position,
        timestamp: now,
        category: obj.category || 'unknown',
      };
    } else {
      memory.objects.unshift({
        name: obj.name,
        position: obj.position,
        timestamp: now,
        category: obj.category || 'unknown',
      });
    }
  }

  if (memory.objects.length > DETECTION_MEMORY_SIZE) {
    memory.objects = memory.objects.slice(0, DETECTION_MEMORY_SIZE);
  }

  memory.lastUpdate = now;
}

export function getSpatialContext(memory: DetectionMemory): string {
  const now = performance.now();
  const recentObjects = memory.objects.filter(
    obj => now - obj.timestamp < MEMORY_RETENTION_MS
  );

  if (recentObjects.length === 0) {
    return '';
  }

  const contextParts: string[] = ['Recent detections for spatial reference:'];

  for (let i = 0; i < Math.min(3, recentObjects.length); i++) {
    const obj = recentObjects[i];
    const refs: string[] = [];

    for (let j = 0; j < recentObjects.length; j++) {
      if (i === j) continue;
      const other = recentObjects[j];
      const dx = obj.position.x - other.position.x;
      const dy = obj.position.y - other.position.y;
      const dz = obj.position.z - other.position.z;

      const direction =
        Math.abs(dx) > Math.abs(dz)
          ? dx > 0 ? 'right of' : 'left of'
          : dz > 0 ? 'behind' : 'in front of';

      refs.push(`${other.name} (${direction})`);
    }

    contextParts.push(`- ${obj.name}: at [${obj.position.x.toFixed(2)}, ${obj.position.y.toFixed(2)}, ${obj.position.z.toFixed(2)}], relative to: ${refs.join(', ') || 'self'}`);
  }

  return contextParts.join('\n');
}

export function isContextualQuery(userInput: string): boolean {
  const contextualPatterns = [
    /where (is|was|does)/i,
    /where.*now/i,
    /did.*see/i,
    /remember/i,
    /previously/i,
    /last.*seen/i,
    /next to/i,
    /near/i,
    /between/i,
    /to the (left|right)/i,
    /behind/i,
    /in front/i,
  ];

  return contextualPatterns.some(pattern => pattern.test(userInput));
}

export function formatWorldMapContext(
  worldMapContext: { name: string; x: number; y: number; z: number }[]
): string {
  return worldMapContext.map(obj => 
    `${obj.name} at [${obj.x.toFixed(2)}, ${obj.y.toFixed(2)}, ${obj.z.toFixed(2)}]`
  ).join('; ');
}

export function enhanceUserInputWithContext(
  userInput: string,
  worldMapContext?: { name: string; x: number; y: number; z: number }[],
  getSpatialContextFn?: () => string
): string {
  const isContextQuery = isContextualQuery(userInput);

  if (!isContextQuery) {
    return userInput;
  }

  const spatialContext = worldMapContext && worldMapContext.length > 0
    ? formatWorldMapContext(worldMapContext)
    : getSpatialContextFn?.() || '';

  if (!spatialContext) {
    return userInput;
  }

  return `${userInput}\n\nKnown objects in environment: ${spatialContext}\n\nUse this spatial context to provide relative directions.`;
}