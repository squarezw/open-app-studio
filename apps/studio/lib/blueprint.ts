import type { AppSpec, ComponentInstance } from '@oas/app-spec';
import type { ComponentManifest } from '@oas/component-registry';

/**
 * Canvas editing core: immutable App Spec operations + snapshot-based
 * undo/redo history. Every canvas interaction goes through `apply`, which is
 * also where the M3 AI sidebar will land its proposed patches — one edit
 * pipeline for humans and agents.
 */

export interface EditorHistory {
  past: AppSpec[];
  present: AppSpec;
  future: AppSpec[];
}

const HISTORY_LIMIT = 50;

export function initHistory(spec: AppSpec): EditorHistory {
  return { past: [], present: spec, future: [] };
}

export function apply(h: EditorHistory, next: AppSpec): EditorHistory {
  if (next === h.present) return h;
  return { past: [...h.past.slice(-HISTORY_LIMIT + 1), h.present], present: next, future: [] };
}

export function undo(h: EditorHistory): EditorHistory {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo(h: EditorHistory): EditorHistory {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

/* ── Immutable spec operations ──────────────────────────────── */

function mapScreen(spec: AppSpec, screenId: string, fn: (components: ComponentInstance[]) => ComponentInstance[]): AppSpec {
  return {
    ...spec,
    screens: spec.screens.map((s) => (s.id === screenId ? { ...s, components: fn(s.components) } : s)),
  };
}

export function updateProp(spec: AppSpec, screenId: string, index: number, key: string, value: unknown): AppSpec {
  return mapScreen(spec, screenId, (components) =>
    components.map((c, i) => (i === index ? { ...c, props: { ...c.props, [key]: value } } : c)),
  );
}

export function addComponent(spec: AppSpec, screenId: string, instance: ComponentInstance): AppSpec {
  return mapScreen(spec, screenId, (components) => [...components, instance]);
}

export function removeComponent(spec: AppSpec, screenId: string, index: number): AppSpec {
  return mapScreen(spec, screenId, (components) => components.filter((_, i) => i !== index));
}

export function moveComponent(spec: AppSpec, screenId: string, index: number, dir: -1 | 1): AppSpec {
  return mapScreen(spec, screenId, (components) => {
    const target = index + dir;
    if (target < 0 || target >= components.length) return components;
    const next = [...components];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
}

export function renameApp(spec: AppSpec, name: string): AppSpec {
  return { ...spec, app: { ...spec.app, name } };
}

/** Sensible starting props for a freshly added block, from its manifest. */
export function defaultPropsFor(manifest: ComponentManifest): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const p of manifest.props) {
    if (p.default !== undefined) props[p.name] = p.default;
    // bindings are seeded even when optional — a list without items renders nothing
    else if (p.type === 'binding' || p.type === 'items') props[p.name] = `$data.${p.name}`;
    else if (!p.required) continue;
    else if (p.type === 'string') props[p.name] = manifest.name;
    else if (p.type === 'number') props[p.name] = 1;
    else if (p.type === 'boolean') props[p.name] = false;
    else if (p.type === 'enum') props[p.name] = p.values?.[0];
  }
  return props;
}
