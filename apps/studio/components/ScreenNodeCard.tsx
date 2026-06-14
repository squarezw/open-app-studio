'use client';

import { useRef, useState } from 'react';
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
  /** When a flow/edge is selected, only its tap markers show (others hidden). */
  highlightEdges?: Set<string>;
  /** Region-select mode: drag a box on the screenshot to generate a component. */
  regionMode?: boolean;
  nodeId?: string;
  onRegion?: (nodeId: string, rect: { x: number; y: number; w: number; h: number }) => void;
}

export default function ScreenNodeCard({ data }: NodeProps) {
  const d = data as unknown as ScreenData;
  const src = d.screenshotUrl?.startsWith('/api/') ? `${GATEWAY_URL}${d.screenshotUrl}` : d.screenshotUrl;
  // Natural (device) pixel size of the screenshot, to map tap coords → overlay %.
  const [nat, setNat] = useState<{ w: number; h: number }>();
  // Drag-to-select box (fractions of the screenshot), while in region mode.
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  const dragging = useRef(false);

  const frac = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
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
        <div
          // nodrag/nopan let us draw a box without React Flow moving the node or panning.
          className={d.regionMode ? 'shot nodrag nopan' : 'shot'}
          style={d.regionMode ? { cursor: 'crosshair' } : undefined}
          onMouseDown={
            d.regionMode
              ? (e) => {
                  e.stopPropagation();
                  dragging.current = true;
                  const p = frac(e, e.currentTarget);
                  setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                }
              : undefined
          }
          onMouseMove={
            d.regionMode
              ? (e) => {
                  if (!dragging.current) return;
                  const p = frac(e, e.currentTarget);
                  setSel((s) => (s ? { ...s, x1: p.x, y1: p.y } : s));
                }
              : undefined
          }
          onMouseUp={
            d.regionMode
              ? (e) => {
                  e.stopPropagation();
                  dragging.current = false;
                  if (sel && d.nodeId && d.onRegion) {
                    const rect = {
                      x: Math.min(sel.x0, sel.x1),
                      y: Math.min(sel.y0, sel.y1),
                      w: Math.abs(sel.x1 - sel.x0),
                      h: Math.abs(sel.y1 - sel.y0),
                    };
                    if (rect.w > 0.02 && rect.h > 0.02) d.onRegion(d.nodeId, rect);
                  }
                  setSel(undefined);
                }
              : undefined
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={d.title}
            draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {d.showTaps &&
            nat &&
            d.taps
              ?.filter((t) => !d.highlightEdges || d.highlightEdges.has(t.edgeId))
              .map((t, i) => (
                <span
                  key={i}
                  className="tap-marker"
                  style={{ left: `${(t.x / nat.w) * 100}%`, top: `${(t.y / nat.h) * 100}%` }}
                  title={t.label}
                />
              ))}
          {d.regionMode && sel && (
            <div
              className="sel-box"
              style={{
                left: `${Math.min(sel.x0, sel.x1) * 100}%`,
                top: `${Math.min(sel.y0, sel.y1) * 100}%`,
                width: `${Math.abs(sel.x1 - sel.x0) * 100}%`,
                height: `${Math.abs(sel.y1 - sel.y0) * 100}%`,
              }}
            />
          )}
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
