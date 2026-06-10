import type { PatternKind, ScreenRole } from '@oas/flow-graph';
import { BUILTINS } from './builtins.js';
import type { ComponentManifest, PropSpec } from './types.js';

export type { ComponentManifest, PropSpec };
export { BUILTINS };

const byRefIndex = new Map(BUILTINS.map((m) => [m.ref, m]));

export function byRef(ref: string): ComponentManifest | undefined {
  return byRefIndex.get(ref);
}

/** Blocks that can realize an IFG pattern kind, role matches first. */
export function byPattern(pattern: PatternKind, role?: ScreenRole): ComponentManifest[] {
  const matches = BUILTINS.filter((m) => m.patterns.includes(pattern));
  if (!role) return matches;
  return [...matches].sort((a, b) => Number(b.roles?.includes(role) ?? false) - Number(a.roles?.includes(role) ?? false));
}

/** Blocks typically used on screens of a given role. */
export function forRole(role: ScreenRole): ComponentManifest[] {
  return BUILTINS.filter((m) => m.roles?.includes(role));
}
