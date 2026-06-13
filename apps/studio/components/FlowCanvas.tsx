'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ifgToFlow, type PartialIfg } from '../lib/ifg-to-flow';
import ScreenNodeCard from './ScreenNodeCard';

const nodeTypes = { screen: ScreenNodeCard };

export default function FlowCanvas({
  graph,
  highlight,
}: {
  graph: PartialIfg;
  highlight?: Set<string>;
}) {
  const instance = useRef<ReactFlowInstance | null>(null);

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

  const { nodes, edges } = useMemo(() => {
    const flow = ifgToFlow(graph);
    const dim = highlightedNodeIds !== undefined; // a flow is selected → spotlight it
    const rfNodes: Node[] = flow.nodes.map((n) => ({
      ...n,
      // Dim every node that isn't on the selected flow so the route stands out.
      style: { opacity: dim && !highlightedNodeIds!.has(n.id) ? 0.18 : 1, transition: 'opacity 200ms' },
    }));
    const rfEdges: Edge[] = flow.edges.map((e) => {
      const on = highlight?.has(e.id) ?? false;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.isBack ? undefined : e.label,
        animated: on,
        style: on
          ? { stroke: '#ff5370', strokeWidth: 2.5 }
          : {
              stroke: e.isBack ? '#3a4458' : '#5a6a8a',
              ...(e.isBack ? { strokeDasharray: '5 5' } : {}),
              opacity: dim ? 0.1 : 1, // fade non-flow edges when a flow is selected
            },
        labelStyle: { fill: '#8b9cbd', fontSize: 10, opacity: dim && !on ? 0.1 : 1 },
        labelBgStyle: { fill: '#0b0e14', fillOpacity: 0.85 },
      };
    });
    return { nodes: rfNodes, edges: rfEdges };
  }, [graph, highlight, highlightedNodeIds]);

  // Re-fit when the node count changes. A finished run loads all nodes in one
  // batch AFTER mount, so the initial `fitView` (which ran on an empty graph)
  // would otherwise leave them positioned outside the viewport — a blank canvas.
  useEffect(() => {
    if (instance.current && nodes.length > 0) {
      instance.current.fitView({ padding: 0.2, duration: 200 });
    }
  }, [nodes.length]);

  // Selecting a flow on the left pans/zooms the canvas to that flow's nodes.
  useEffect(() => {
    if (!instance.current || !highlightedNodeIds || highlightedNodeIds.size === 0) return;
    instance.current.fitView({
      padding: 0.35,
      duration: 400,
      nodes: [...highlightedNodeIds].map((id) => ({ id })),
    });
  }, [highlightedNodeIds]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
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
      <Background gap={24} color="#1c2230" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable bgColor="#11141c" maskColor="rgba(11,14,20,.7)" />
    </ReactFlow>
  );
}
