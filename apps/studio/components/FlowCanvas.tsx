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
}: {
  graph: PartialIfg;
  highlight?: Set<string>;
  /** Persisted node positions to restore (overrides the auto-layout). */
  savedPositions?: NodePositions;
  /** Persist the current arrangement; enables the Save tool when provided. */
  onSaveLayout?: (positions: NodePositions) => Promise<void>;
}) {
  const instance = useRef<ReactFlowInstance | null>(null);
  // Nodes are draggable and their positions live here (not recomputed on every
  // render), so a drag sticks. Edges + highlight styling stay derived.
  const [layout, setLayout, onNodesChange] = useNodesState<Node>([]);
  // Nodes the user has dragged — their positions are never overwritten by the
  // auto-layout / saved-layout sync below.
  const draggedRef = useRef(new Set<string>());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

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
  // else its saved position, else the auto-layout slot. New nodes from a live
  // run appear at their auto-layout position.
  useEffect(() => {
    const auto = ifgToFlow(graph).nodes as unknown as Node[];
    setLayout((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return auto.map((n) => {
        const existing = prevById.get(n.id);
        const position =
          draggedRef.current.has(n.id) && existing ? existing.position : savedPositions?.[n.id] ?? n.position;
        return { ...n, position };
      });
    });
  }, [graph, savedPositions, setLayout]);

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
          // Back edges stay unlabeled — their labels collide with the forward edge.
          label: e.isBack ? undefined : e.label,
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
    [graph, highlight, dim],
  );

  // Apply the highlight dimming to the user-positioned nodes at render time.
  const displayNodes: Node[] = useMemo(
    () =>
      layout.map((n) => ({
        ...n,
        style: {
          ...n.style,
          opacity: dim && !highlightedNodeIds!.has(n.id) ? 0.18 : 1,
          transition: 'opacity 200ms',
        },
      })),
    [layout, dim, highlightedNodeIds],
  );

  // Re-fit when the node count changes. A finished run loads all nodes in one
  // batch AFTER mount, so the initial fitView (on an empty graph) would
  // otherwise leave them off-screen.
  useEffect(() => {
    if (instance.current && layout.length > 0) {
      instance.current.fitView({ padding: 0.2, duration: 200 });
    }
  }, [layout.length]);

  // Selecting a flow on the left pans/zooms the canvas to that flow's nodes.
  useEffect(() => {
    if (!instance.current || !highlightedNodeIds || highlightedNodeIds.size === 0) return;
    instance.current.fitView({
      padding: 0.35,
      duration: 400,
      nodes: [...highlightedNodeIds].map((id) => ({ id })),
    });
  }, [highlightedNodeIds]);

  // "Tidy up": discard manual positions and restore the deterministic layout.
  const realign = useCallback(() => {
    draggedRef.current.clear();
    setLayout(ifgToFlow(graph).nodes as unknown as Node[]);
    setTimeout(() => instance.current?.fitView({ padding: 0.2, duration: 300 }), 0);
  }, [graph, setLayout]);

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
      nodesDraggable
      nodesConnectable={false}
      style={{ background: 'var(--bg)' }}
    >
      <Panel position="top-right" className="canvas-tools">
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
