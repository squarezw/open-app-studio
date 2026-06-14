export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4400';

export function gatewayWsUrl(path: string): string {
  return `${GATEWAY_URL.replace(/^http/, 'ws')}${path}`;
}

export type NodePositions = Record<string, { x: number; y: number }>;

/** Load the saved canvas layout for a run (empty when none saved yet). */
export async function fetchLayout(id: string): Promise<NodePositions> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/runs/${id}/layout`);
    if (!res.ok) return {};
    const data = (await res.json()) as { positions?: NodePositions };
    return data.positions ?? {};
  } catch {
    return {};
  }
}

/** Persist the canvas layout (node positions) for a run. */
export async function saveLayout(id: string, positions: NodePositions): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/api/runs/${id}/layout`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ positions }),
  });
  if (!res.ok) throw new Error(`save layout failed: HTTP ${res.status}`);
}

/** Generate a component from a region of a screen's screenshot. Returns the new ref. */
export async function generateFromRegion(
  runId: string,
  nodeId: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<{ ref: string; describedAs: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/runs/${runId}/nodes/${nodeId}/component`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rect }),
  });
  const data = (await res.json()) as { manifest?: { ref: string }; describedAs?: string; error?: string };
  if (!res.ok || !data.manifest) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { ref: data.manifest.ref, describedAs: data.describedAs ?? '' };
}

/** Pause / resume / stop an in-flight run. */
export async function controlRun(id: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
  const res = await fetch(`${GATEWAY_URL}/api/runs/${id}/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`${action} failed: HTTP ${res.status}`);
}

export interface RunSummary {
  id: string;
  appId: string;
  status: 'running' | 'paused' | 'done' | 'error';
  rerunnable?: boolean;
  createdAt: string;
  coverage?: { nodes?: number; edges?: number; frontier?: number; actions?: number };
  error?: string;
}
