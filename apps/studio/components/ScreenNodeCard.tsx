'use client';

import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GATEWAY_URL } from '../lib/gateway';
import type { TapMarker } from '../lib/ifg-to-flow';

interface ScreenData {
  title: string;
  role?: string;
  visits: number;
  screenshotUrl?: string;
  phase?: 'pre-main' | 'main';
  section?: string;
  hasTabbar?: boolean;
  taps?: TapMarker[];
  showTaps?: boolean;
}

export default function ScreenNodeCard({ data }: NodeProps) {
  const d = data as unknown as ScreenData;
  const src = d.screenshotUrl?.startsWith('/api/') ? `${GATEWAY_URL}${d.screenshotUrl}` : d.screenshotUrl;
  // Natural (device) pixel size of the screenshot, to map tap coords → overlay %.
  const [nat, setNat] = useState<{ w: number; h: number }>();
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
        <div className="shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={d.title}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {d.showTaps &&
            nat &&
            d.taps?.map((t, i) => (
              <span
                key={i}
                className="tap-marker"
                style={{ left: `${(t.x / nat.w) * 100}%`, top: `${(t.y / nat.h) * 100}%` }}
                title={t.label}
              />
            ))}
        </div>
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
