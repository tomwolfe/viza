import * as THREE from 'three';
import { CONFIG } from '@/config';

export type ObjectCategory = 'tool' | 'trash' | 'clutter' | 'keep' | 'unknown';

export function categorizeObject(name: string, action?: string): ObjectCategory {
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

export function generateObjectId(name: string, position: THREE.Vector3): string {
  const normalized = `${name.toLowerCase().replace(/\s+/g, '-')}`;
  return normalized;
}