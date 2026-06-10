'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

interface ScreenData {
  title: string;
  role?: string;
  visits: number;
  screenshotUrl?: string;
}

export default function ScreenNodeCard({ data }: NodeProps) {
  const d = data as unknown as ScreenData;
  return (
    <div className="screen-node" data-role={d.role ?? 'other'}>
      {d.screenshotUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.screenshotUrl} alt={d.title} />
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
