'use client';

import { useMemo } from 'react';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
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
  const { nodes, edges } = useMemo(() => {
    const flow = ifgToFlow(graph);
    const rfNodes: Node[] = flow.nodes;
    const rfEdges: Edge[] = flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      // Back edges stay unlabeled — their labels collide with the forward
      // edge between the same node pair, and "back" carries no information.
      label: e.isBack ? undefined : e.label,
      animated: highlight ? highlight.has(e.id) : e.animated,
      style: highlight?.has(e.id)
        ? { stroke: '#ff5370', strokeWidth: 2.5 }
        : e.isBack
          ? { stroke: '#3a4458', strokeDasharray: '5 5' }
          : { stroke: '#5a6a8a' },
      labelStyle: { fill: '#8b9cbd', fontSize: 10 },
      labelBgStyle: { fill: '#0b0e14', fillOpacity: 0.85 },
    }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [graph, highlight]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
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
