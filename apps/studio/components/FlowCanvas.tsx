'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ifgToFlow, type PartialIfg } from '../lib/ifg-to-flow';
import type { NodePositions } from '../lib/gateway';
import ScreenNodeCard from './ScreenNodeCard';

const nodeTypes = { screen: ScreenNodeCard };

export default function FlowCanvas({
  graph,
  highlight,
  savedPositions,
  onSaveLayout,
  runStatus,
  onPause,
  onResume,
  onStop,
  onEdgeSelect,
}: {
  graph: PartialIfg;
  highlight?: Set<string>;
  /** Clicking an edge selects the path(s) running through it. */
  onEdgeSelect?: (edgeId: string) => void;
  /** Persisted node positions to restore (overrides the auto-layout). */
  savedPositions?: NodePositions;
  /** Persist the current arrangement; enables the Save tool when provided. */
  onSaveLayout?: (positions: NodePositions) => Promise<void>;
  /** Live run state — while running/paused the toolbar shows run controls. */
  runStatus?: 'running' | 'paused' | 'done' | 'error';
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}) {
  const instance = useRef<ReactFlowInstance | null>(null);
  const [layout, setLayout, onNodesChange] = useNodesState<Node>([]);
  const draggedRef = useRef(new Set<string>());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  // View toggles: screenshots in cards, "what was tapped" on edges, and the
  // click-region overlay (markers on the screenshot showing where taps landed).
  const [showImages, setShowImages] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showTaps, setShowTaps] = useState(false);

  // Node ids on the highlighted (selected) flow — its edges' endpoints.
  const highlightedNodeIds = useMemo(() => {
    if (!highlight || highlight.size === 0) return undefined;
    const ids = new Set<string>();
    for (const e of ifgToFlow(graph).edges) {
      if (highlight.has(e.id)) {
        ids.add(e.source);
        ids.add(e.target);
      }
    }
    return ids;
  }, [graph, highlight]);

  // Fold the graph into the draggable layout: keep a node's dragged position,
  // else its saved position, else the auto-layout slot (which depends on
  // whether screenshots are shown — taller cards need more row spacing).
  useEffect(() => {
    const auto = ifgToFlow(graph, { showImages }).nodes as unknown as Node[];
    setLayout((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return auto.map((n) => {
        const existing = prevById.get(n.id);
        const position =
          draggedRef.current.has(n.id) && existing ? existing.position : savedPositions?.[n.id] ?? n.position;
        return { ...n, position };
      });
    });
  }, [graph, savedPositions, showImages, setLayout]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      for (const ch of changes) {
        if (ch.type === 'position' && ch.dragging === false) draggedRef.current.add(ch.id);
      }
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const dim = highlightedNodeIds !== undefined; // a flow is selected → spotlight it

  const edges: Edge[] = useMemo(
    () =>
      ifgToFlow(graph).edges.map((e) => {
        const on = highlight?.has(e.id) ?? false;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          // "What was tapped to get here" — toggleable; back edges stay unlabeled.
          label: showLabels && !e.isBack ? e.label : undefined,
          animated: on,
          style: on
            ? { stroke: '#ff5370', strokeWidth: 2.5 }
            : {
                stroke: e.isBack ? '#3a4458' : '#5a6a8a',
                ...(e.isBack ? { strokeDasharray: '5 5' } : {}),
                opacity: dim ? 0.1 : 1,
              },
          labelStyle: { fill: '#8b9cbd', fontSize: 10, opacity: dim && !on ? 0.1 : 1 },
          labelBgStyle: { fill: '#0b0e14', fillOpacity: 0.85 },
        };
      }),
    [graph, highlight, dim, showLabels],
  );

  const displayNodes: Node[] = useMemo(
    () =>
      layout.map((n) => {
        const dimmed = dim && !highlightedNodeIds!.has(n.id);
        return {
          ...n,
          // Dimmed (off-path) nodes are inert: dragging over them pans the
          // canvas instead of moving the node. Only the focused path is draggable.
          draggable: !dimmed,
          data: { ...n.data, showTaps, highlightEdges: highlight },
          style: { ...n.style, opacity: dimmed ? 0.18 : 1, transition: 'opacity 200ms' },
        };
      }),
    [layout, dim, highlightedNodeIds, showTaps, highlight],
  );

  // Re-fit when the node count changes, or when toggling images reflows the
  // layout (cards change height → positions change).
  useEffect(() => {
    if (instance.current && layout.length > 0) {
      instance.current.fitView({ padding: 0.2, duration: 200 });
    }
  }, [layout.length, showImages]);

  // Selecting a flow on the left pans/zooms the canvas to that flow's nodes.
  useEffect(() => {
    if (!instance.current || !highlightedNodeIds || highlightedNodeIds.size === 0) return;
    instance.current.fitView({
      padding: 0.35,
      duration: 400,
      nodes: [...highlightedNodeIds].map((id) => ({ id })),
    });
  }, [highlightedNodeIds]);

  const realign = useCallback(() => {
    draggedRef.current.clear();
    setLayout(ifgToFlow(graph, { showImages }).nodes as unknown as Node[]);
    setTimeout(() => instance.current?.fitView({ padding: 0.2, duration: 300 }), 0);
  }, [graph, showImages, setLayout]);

  const save = useCallback(async () => {
    if (!onSaveLayout) return;
    setSaveState('saving');
    try {
      const positions: NodePositions = {};
      for (const n of layout) positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      await onSaveLayout(positions);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      setSaveState('idle');
    }
  }, [layout, onSaveLayout]);

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
      onInit={(inst) => {
        instance.current = inst;
        inst.fitView({ padding: 0.2 });
      }}
      onEdgeClick={(_, edge) => onEdgeSelect?.(edge.id)}
      nodesDraggable
      nodesConnectable={false}
      style={{ background: 'var(--bg)' }}
    >
      <Panel position="top-right" className="canvas-tools">
        {runStatus === 'running' || runStatus === 'paused' ? (
          <>
            <span className="run-state" data-state={runStatus}>
              {runStatus === 'paused' ? '⏸ Paused' : '● Analyzing'}
            </span>
            {runStatus === 'running' ? (
              <button title="Pause exploration" onClick={onPause} aria-label="Pause">
                <PauseIcon />
              </button>
            ) : (
              <button title="Resume exploration" onClick={onResume} aria-label="Resume">
                <PlayIcon />
              </button>
            )}
            <button title="Stop exploration" onClick={onStop} aria-label="Stop" className="danger">
              <StopIcon />
            </button>
          </>
        ) : (
          <>
        <button
          title={showImages ? 'Hide screenshots' : 'Show screenshots'}
          onClick={() => setShowImages((v) => !v)}
          data-state={showImages ? 'on' : 'off'}
          aria-label="Toggle screenshots"
        >
          <ImageIcon />
        </button>
        <button
          title={showLabels ? 'Hide tap labels' : 'Show tap labels'}
          onClick={() => setShowLabels((v) => !v)}
          data-state={showLabels ? 'on' : 'off'}
          aria-label="Toggle edge labels"
        >
          <TagIcon />
        </button>
        <button
          title={showTaps ? 'Hide tapped regions' : 'Show tapped regions on screenshots'}
          onClick={() => setShowTaps((v) => !v)}
          data-state={showTaps ? 'on' : 'off'}
          aria-label="Toggle tapped regions"
        >
          <CrosshairIcon />
        </button>
        <span className="sep" />
        <button title="Tidy up — restore the automatic layout" onClick={realign} aria-label="Tidy up layout">
          <GridIcon />
        </button>
        {onSaveLayout && (
          <button
            title="Save this layout"
            onClick={save}
            data-state={saveState}
            disabled={saveState === 'saving'}
            aria-label="Save layout"
          >
            {saveState === 'saved' ? <CheckIcon /> : <SaveIcon />}
          </button>
        )}
          </>
        )}
      </Panel>
      <Background gap={24} color="#1c2230" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable bgColor="#11141c" maskColor="rgba(11,14,20,.7)" />
    </ReactFlow>
  );
}

const ICON = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function ImageIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg {...ICON}>
      <path d="M20.59 13.41 13.42 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function CrosshairIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg {...ICON}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...ICON}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...ICON} fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...ICON} fill="currentColor" stroke="none">
      <path d="M7 5v14l12-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg {...ICON} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
