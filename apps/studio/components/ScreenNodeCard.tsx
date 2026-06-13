'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GATEWAY_URL } from '../lib/gateway';

interface ScreenData {
  title: string;
  role?: string;
  visits: number;
  screenshotUrl?: string;
  phase?: 'pre-main' | 'main';
  section?: string;
  hasTabbar?: boolean;
}

export default function ScreenNodeCard({ data }: NodeProps) {
  const d = data as unknown as ScreenData;
  const src = d.screenshotUrl?.startsWith('/api/') ? `${GATEWAY_URL}${d.screenshotUrl}` : d.screenshotUrl;
  return (
    <div className="screen-node" data-role={d.role ?? 'other'} data-phase={d.phase ?? ''}>
      {(d.phase === 'pre-main' || d.hasTabbar || d.section) && (
        <div className="badges">
          {d.phase === 'pre-main' && <span className="badge pre-main">pre-main</span>}
          {d.hasTabbar && <span className="badge tabbar">⬓ tabbar</span>}
          {d.section && <span className="badge section">{d.section}</span>}
        </div>
      )}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={d.title} />
      )}
      <div className="title">{d.title}</div>
      <div className="meta">
        {d.role ?? 'unlabeled'} · {d.visits} visit{d.visits === 1 ? '' : 's'}
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
