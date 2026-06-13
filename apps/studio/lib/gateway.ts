export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4400';

export function gatewayWsUrl(path: string): string {
  return `${GATEWAY_URL.replace(/^http/, 'ws')}${path}`;
}

export interface RunSummary {
  id: string;
  appId: string;
  status: 'running' | 'done' | 'error';
  rerunnable?: boolean;
  createdAt: string;
  coverage?: { nodes?: number; edges?: number; frontier?: number; actions?: number };
  error?: string;
}
